/**
 * Model eval (P17, D-19). Grades every drawn gold fixture with each candidate
 * model, k times, through the SAME Grader the app uses (prompt, schema,
 * one corrective retry), then scores the results against the gold verdicts.
 *
 *   bun run eval                       # projection only: prints cost, spends nothing
 *   bun run eval --yes                 # run it (refuses above --max-usd, default $2)
 *   bun run eval --models a,b --reference c --k 3 --cases p1-standard,p2-standard
 *
 * Touches NO database. The ledger is in memory, nothing here builds a SqlClient
 * (the type system would demand one), and the DB URLs from .env are removed
 * from this process's environment on startup so nothing can pick them up.
 *
 * Writes evals/results/<run>/results.json (every call's latency and token usage,
 * to calibrate the load-test simulator) and summary.md.
 */
import { EVAL_CASES, SAMPLE_PROBLEMS } from "@autograder/domain"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Data, Duration, Effect, Layer, Option, Redacted, Ref } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AppConfig } from "../../apps/server/src/AppConfig.ts"
import { Grader } from "../../apps/server/src/grading/Grader.ts"
import { BudgetGuard } from "../../apps/server/src/model/BudgetGuard.ts"
import { type ModelCallRecord, ModelCallLedger } from "../../apps/server/src/model/Ledger.ts"
import { fetchCatalog, type ModelInfo, OpenRouterModelLive } from "../../apps/server/src/model/ModelClient.ts"
import { computeMetrics, gates, type Gold, type Metrics, type Sample } from "./metrics.ts"

const DEFAULT_CHEAP = [
  "deepseek/deepseek-v4.1-flash", // cheapest end of the vision tier
  "openai/gpt-6-luna",
  "google/gemini-3.1-flash-lite",
  "qwen/qwen3-vl-30b-a3b-instruct" // open weights: the self-hosting path at 1M students
]
const DEFAULT_REFERENCE = "openai/gpt-6.1-sol"

// Conservative per-call token estimates for the projection. Actual usage is measured and reported.
const EST_TEXT_TOKENS = 1_100 // grade.v2 system + problem + reference solution + criteria
const EST_IMAGE_TOKENS = 1_600 // a cropped ~1024px ink image; providers vary (tiles vs w*h/750)
const EST_OUTPUT_TOKENS = 700 // transcription + verdicts + low-effort reasoning
const RETRY_FACTOR = 1.25 // headroom for corrective retries
const SAFETY_FACTOR = 1.5

// Belt and braces: the eval must never reach the prod (or any) database.
for (const key of Object.keys(process.env)) if (key.startsWith("DATABASE_URL")) delete process.env[key]

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const FIXTURES = here("../fixtures")
const RESULTS = here("../results")

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 3)}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
// A rate with no eligible cases is "n/a", not a misleading 0%.
const ci = (i: { p: number; low: number; high: number; n: number }) => i.n === 0 ? "n/a" : `${pct(i.p)} [${pct(i.low)}–${pct(i.high)}]`

/**
 * AppConfig for a DB-less script: only the model and prompt settings matter
 * here; the server-only fields are inert placeholders.
 */
const EvalConfig = Layer.effect(
  AppConfig,
  Effect.gen(function*() {
    const apiKey = yield* Config.option(Config.Redacted("OPENROUTER_API_KEY"))
    const baseUrl = yield* Config.String("MODEL_BASE_URL").pipe(Config.withDefault("https://openrouter.ai/api/v1"))
    const budgetFloorUsd = yield* Config.Finite("BUDGET_FLOOR_USD").pipe(Config.withDefault(5))
    return AppConfig.of({
      port: 0,
      version: "eval",
      databaseUrl: Redacted.make("unused"),
      dbPoolMax: 1,
      adminToken: Redacted.make("unused"),
      webDist: "unused",
      promptsDir: here("../../prompts"),
      fixtureDir: Option.none(),
      model: {
        apiKey: Option.filter(apiKey, (k) => Redacted.value(k) !== ""),
        baseUrl: baseUrl.replace(/\/$/, ""),
        gradingModel: DEFAULT_CHEAP[0]!,
        rubricModel: "unused",
        timeout: Duration.seconds(90),
        budgetFloorUsd
      },
      worker: {
        concurrency: 1,
        maxInFlightGlobal: 1,
        lease: Duration.seconds(60),
        idlePoll: Duration.minutes(60),
        shutdownGrace: Duration.seconds(1)
      }
    })
  })
)

class EvalError extends Data.TaggedError("EvalError")<{ readonly message: string }> {}

interface Task {
  readonly model: string
  readonly caseKey: string
  readonly run: number
}

const program = (callsRef: Ref.Ref<ReadonlyArray<ModelCallRecord>>) => Effect.gen(function*() {
  const cheap = (arg("models") ?? DEFAULT_CHEAP.join(",")).split(",").filter(Boolean)
  // `--reference none` skips the reference model (used for the one-case smoke run).
  const reference = arg("reference") ?? DEFAULT_REFERENCE
  const models = reference === "none" ? cheap : [...cheap, reference]
  const k = Number(arg("k") ?? 3)
  const maxUsd = Number(arg("max-usd") ?? 2)
  const concurrency = Number(arg("concurrency") ?? 6)
  const only = arg("cases")?.split(",")
  const cases = EVAL_CASES.filter((c) => only === undefined || only.includes(c.key))

  // --- fixtures ---------------------------------------------------------------
  const missing = cases.filter((c) => !existsSync(`${FIXTURES}/${c.key}.png`))
  const ready = cases.filter((c) => existsSync(`${FIXTURES}/${c.key}.png`))
  console.log(`\nDatabase: none (in-memory ledger; DATABASE_URL* removed from env)`)
  console.log(`Fixtures: ${ready.length}/${cases.length} drawn in evals/fixtures/`)
  if (missing.length > 0) console.log(`  missing: ${missing.map((c) => c.key).join(", ")}`)
  // With nothing drawn yet, still project the full set so the cost is known up front.
  const projectedCases = ready.length === 0 ? cases.length : ready.length

  // --- live prices and capability check (P17: pull prices at eval time) --------
  const http = yield* HttpClient.HttpClient
  const config = yield* AppConfig
  const catalog = yield* fetchCatalog(http, config.model.baseUrl)
  const infos: Array<ModelInfo> = []
  for (const m of models) {
    const info = catalog.get(m)
    if (info === undefined) return yield* Effect.fail(new EvalError({ message: `model ${m} not in the OpenRouter catalog` }))
    if (!info.acceptsImages) return yield* Effect.fail(new EvalError({ message: `model ${m} does not accept images` }))
    if (!info.supportedParameters.has("response_format")) return yield* Effect.fail(new EvalError({ message: `model ${m} lacks response_format` }))
    infos.push(info)
  }

  // --- projection, printed before anything runs ------------------------------
  const callsPerModel = projectedCases * k
  const perCall = (i: ModelInfo) =>
    ((EST_TEXT_TOKENS + EST_IMAGE_TOKENS) * i.promptPrice + EST_OUTPUT_TOKENS * i.completionPrice) * RETRY_FACTOR * SAFETY_FACTOR
  const projected = infos.map((i) => ({ model: i.id, role: i.id === reference ? "reference" : "cheap", perCall: perCall(i), total: perCall(i) * callsPerModel, i }))
  const projectedTotal = projected.reduce((s, p) => s + p.total, 0)
  console.log(`\nProjected cost: ${projectedCases} cases × k=${k} × ${models.length} models = ${callsPerModel * models.length} grades`)
  console.log(`  (estimate: ${EST_TEXT_TOKENS + EST_IMAGE_TOKENS} in / ${EST_OUTPUT_TOKENS} out tokens per call, ×${RETRY_FACTOR} retries, ×${SAFETY_FACTOR} safety)`)
  for (const p of projected) {
    console.log(`  ${p.model.padEnd(36)} ${p.role.padEnd(9)} $${(p.i.promptPrice * 1e6).toFixed(3)}/M in  $${(p.i.completionPrice * 1e6).toFixed(3)}/M out  ~${usd(p.perCall)}/grade  ~${usd(p.total)}`)
  }
  console.log(`  TOTAL ~${usd(projectedTotal)} (approval limit ${usd(maxUsd)})`)
  const guard = yield* BudgetGuard
  const remaining = yield* guard.remaining
  console.log(`  OpenRouter key remaining: ${Option.match(remaining, { onNone: () => "no limit", onSome: (r) => usd(r) })}; floor ${usd(config.model.budgetFloorUsd)}`)

  if (!flag("yes")) {
    console.log("\nProjection only. Re-run with --yes to spend it.")
    return
  }
  if (ready.length === 0) return yield* Effect.fail(new EvalError({ message: "no fixtures drawn yet; open /dev/fixtures" }))
  if (projectedTotal > maxUsd) return yield* Effect.fail(new EvalError({ message: `projected ${usd(projectedTotal)} exceeds --max-usd ${usd(maxUsd)}; needs explicit approval` }))
  yield* guard.check(projectedTotal)

  // --- run ------------------------------------------------------------------
  const grader = yield* Grader
  const tasks: Array<Task> = models.flatMap((model) => ready.flatMap((c) => Array.from({ length: k }, (_, r) => ({ model, caseKey: c.key, run: r + 1 }))))
  const tag = (t: Task) => `${t.model}::${t.caseKey}::${t.run}`
  let done = 0
  const outcomes = yield* Effect.forEach(tasks, (t) => {
    const c = cases.find((x) => x.key === t.caseKey)!
    const problem = SAMPLE_PROBLEMS.find((p) => p.key === c.problem)!
    return grader.grade({
      problem: { prompt: problem.prompt, answerKey: problem.answerKey },
      rubric: problem.rubric,
      imagePng: new Uint8Array(readFileSync(`${FIXTURES}/${c.key}.png`)),
      model: t.model,
      purpose: "eval",
      runId: tag(t)
    }).pipe(
      Effect.result,
      Effect.tap(() => Effect.sync(() => {
        done++
        if (done % 10 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length} graded`)
      })),
      Effect.map((result) => ({ task: t, result }))
    )
  }, { concurrency })

  // --- score ------------------------------------------------------------------
  const calls = yield* Ref.get(callsRef)
  const golds: Array<Gold> = cases.map((c) => ({
    key: c.key,
    expect: c.expect,
    weights: SAMPLE_PROBLEMS.find((p) => p.key === c.problem)!.rubric.items.map((i) => i.points)
  }))
  const samplesFor = (model: string): Array<Sample> =>
    outcomes.filter((o) => o.task.model === model).map(({ task, result }) => {
      const mine = calls.filter((c) => c.runId === tag(task))
      const base = {
        caseKey: task.caseKey,
        run: task.run,
        firstAttemptValid: mine[0]?.outcome === "ok",
        costUsd: mine.reduce((s, c) => s + (c.costUsd ?? 0), 0),
        latencyMs: mine.reduce((s, c) => s + c.latencyMs, 0)
      }
      if (result._tag === "Failure") {
        return { ...base, outcome: result.failure._tag === "InvalidModelOutput" ? "invalid" as const : "error" as const, error: result.failure.message }
      }
      const r = result.success
      const read = { transcription: r.output.transcription, confidence: r.output.confidence, evidence: r.output.criteria.map((c) => `${c.id}: ${c.evidence}`) }
      if (!r.output.legible) return { ...base, ...read, outcome: "abstained" as const }
      const problem = SAMPLE_PROBLEMS.find((p) => p.key === cases.find((c) => c.key === task.caseKey)!.problem)!
      return { ...base, ...read, outcome: "graded" as const, total: r.totalPoints, met: problem.rubric.items.map((i) => r.met.get(i.id) === true) }
    })

  const perModel = models.map((model) => {
    const samples = samplesFor(model)
    const latencies = calls.filter((c) => c.model === model && c.outcome === "ok").map((c) => c.latencyMs)
    const metrics = computeMetrics(samples, golds, latencies)
    return { model, role: model === reference ? "reference" : "cheap", metrics, gates: gates(metrics), samples, price: catalog.get(model)! }
  })

  // Cheapest cheap model that clears every gate; otherwise the best one, said plainly (D-19 amendment).
  const cheapRows = perModel.filter((m) => m.role === "cheap")
  const passing = cheapRows.filter((m) => m.gates.every((g) => g.pass)).sort((a, b) => a.metrics.costPerGradeUsd - b.metrics.costPerGradeUsd)
  const best = [...cheapRows].sort((a, b) =>
    b.gates.filter((g) => g.pass).length - a.gates.filter((g) => g.pass).length ||
    b.metrics.exactTotal.p - a.metrics.exactTotal.p ||
    a.metrics.costPerGradeUsd - b.metrics.costPerGradeUsd
  )[0]!
  const recommendation = passing[0]
    ? { model: passing[0].model, clearsBar: true, note: "cheapest cheap model that clears every gate" }
    : { model: best.model, clearsBar: false, note: `no cheap model cleared every gate; best is ${best.model}, missing: ${best.gates.filter((g) => !g.pass).map((g) => g.name).join(", ")}` }

  const actualCost = calls.reduce((s, c) => s + (c.costUsd ?? 0), 0)
  const runName = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = `${RESULTS}/${runName}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/results.json`, JSON.stringify({
    run: runName,
    promptVersion: "grade.v2",
    k,
    cases: ready.map((c) => c.key),
    missingCases: missing.map((c) => c.key),
    projectedUsd: projectedTotal,
    actualUsd: actualCost,
    recommendation,
    models: perModel.map(({ samples, price, ...rest }) => ({
      ...rest,
      pricePerMillion: { input: price.promptPrice * 1e6, output: price.completionPrice * 1e6 },
      samples
    })),
    // Every call, for calibrating the load-test simulator's latency and token model.
    calls: calls.map((c: ModelCallRecord) => ({
      model: c.model, tag: c.runId, outcome: c.outcome, latencyMs: c.latencyMs, inputTokens: c.inputTokens,
      outputTokens: c.outputTokens, costUsd: c.costUsd, httpStatus: c.httpStatus, error: c.error
    }))
  }, null, 2))
  writeFileSync(`${dir}/summary.md`, summary(perModel, recommendation, { ready: ready.length, k, projectedTotal, actualCost, missing: missing.map((c) => c.key) }))
  console.log(`\n${summary(perModel, recommendation, { ready: ready.length, k, projectedTotal, actualCost, missing: missing.map((c) => c.key) })}`)
  console.log(`Results: evals/results/${runName}/`)
})

const summary = (
  rows: ReadonlyArray<{ model: string; role: string; metrics: Metrics; gates: ReadonlyArray<{ name: string; pass: boolean; uncertain: boolean }> }>,
  rec: { model: string; clearsBar: boolean; note: string },
  meta: { ready: number; k: number; projectedTotal: number; actualCost: number; missing: ReadonlyArray<string> }
) => {
  const lines = [
    `# Eval results`,
    ``,
    `${meta.ready} gold cases × k=${meta.k} runs per model, grade.v2 prompt. Projected ${usd(meta.projectedTotal)}, actual ${usd(meta.actualCost)}.`,
    meta.missing.length > 0 ? `Missing fixtures (not scored): ${meta.missing.join(", ")}.` : ``,
    `Rates are pooled over runs; brackets are Wilson 95% CIs with n = distinct cases.`,
    ``,
    `| Model | Role | Exact total | Within 1 | Criterion acc. | False full credit | False zero | Abstain on unreadable | Flip rate | Schema-valid | p50 / p95 latency | Cost / grade | Gates |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map(({ model, role, metrics: m, gates: g }) =>
      `| ${model} | ${role} | ${ci(m.exactTotal)} | ${ci(m.withinOne)} | ${ci(m.criterionAccuracy)} | ${ci(m.falseFullCredit)} | ${ci(m.falseZero)} | ${ci(m.abstentionCorrect)} | ${ci(m.flipRate)} | ${ci(m.schemaValid)} | ${(m.latencyP50Ms / 1000).toFixed(1)} s / ${(m.latencyP95Ms / 1000).toFixed(1)} s | ${usd(m.costPerGradeUsd)} | ${g.filter((x) => x.pass).length}/${g.length}${g.some((x) => x.uncertain) ? " (some within CI)" : ""} |`
    ),
    ``,
    `**Recommendation:** \`${rec.model}\`. ${rec.note}.`,
    ``
  ]
  for (const r of rows) {
    const failed = r.gates.filter((g) => !g.pass).map((g) => g.name)
    lines.push(`- ${r.model}: ${failed.length === 0 ? "clears every gate" : `misses ${failed.join(", ")}`}${r.metrics.providerErrors > 0 ? `; ${r.metrics.providerErrors} provider error(s)` : ""}`)
  }
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n"
}

// The in-memory ledger is shared by the Grader (which records every call) and the scorer.
const main = Effect.gen(function*() {
  const calls = yield* Ref.make<ReadonlyArray<ModelCallRecord>>([])
  yield* program(calls).pipe(Effect.provide(Grader.layer.pipe(Layer.provide(ModelCallLedger.memory(calls)))))
})

const Live = Layer.mergeAll(OpenRouterModelLive, BudgetGuard.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(FetchHttpClient.layer, BunServices.layer)),
  Layer.provideMerge(EvalConfig)
)

main.pipe(Effect.provide(Live), BunRuntime.runMain)
