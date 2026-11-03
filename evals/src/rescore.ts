/**
 * Rebuilds a run's summary.md from its saved results.json, with no model calls.
 * Used when scoring or reporting logic changes after a paid run.
 *
 *   bun evals/src/rescore.ts evals/results/<run>
 */
import { EVAL_CASES, SAMPLE_PROBLEMS } from "@autograder/domain"
import { readFileSync, writeFileSync } from "node:fs"
import { computeMetrics, gates, type Gold, type Sample } from "./metrics.ts"
import { listPriceUsd, type ModelRow, recommend, summary, wrongCases } from "./report.ts"

interface Saved {
  readonly k: number
  readonly cases: ReadonlyArray<string>
  readonly projectedUsd: number
  readonly actualUsd: number
  readonly models: ReadonlyArray<{ model: string; role: string; pricePerMillion: { input: number; output: number }; samples: ReadonlyArray<Sample> }>
  readonly calls: ReadonlyArray<{ model: string; tag: string; outcome: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }>
}

const dir = process.argv[2]
if (dir === undefined) throw new Error("usage: bun evals/src/rescore.ts evals/results/<run>")
const saved = JSON.parse(readFileSync(`${dir}/results.json`, "utf8")) as Saved
const cases = EVAL_CASES.filter((c) => saved.cases.includes(c.key))
const golds: Array<Gold> = cases.map((c) => ({
  key: c.key,
  expect: c.expect,
  weights: SAMPLE_PROBLEMS.find((p) => p.key === c.problem)!.rubric.items.map((i) => i.points)
}))

const rows: Array<ModelRow> = saved.models.map((m) => {
  const price = { promptPrice: m.pricePerMillion.input / 1e6, completionPrice: m.pricePerMillion.output / 1e6 }
  const samples = m.samples.map((s) => {
    const mine = saved.calls.filter((c) => c.tag === `${m.model}::${s.caseKey}::${s.run}`)
    return {
      ...s,
      costUsd: mine.reduce((sum, c) => sum + listPriceUsd(price, c), 0),
      billedUsd: mine.reduce((sum, c) => sum + (c.costUsd ?? 0), 0)
    }
  })
  const latencies = saved.calls.filter((c) => c.model === m.model && c.outcome === "ok").map((c) => c.latencyMs)
  const metrics = computeMetrics(samples, golds, latencies)
  return { model: m.model, role: m.role, metrics, gates: gates(metrics), samples }
})

const listCost = rows.reduce((s, r) => s + r.samples.reduce((x, y) => x + y.costUsd, 0), 0)
const rec = recommend(rows)
const md = summary(rows, rec, { ready: cases.length, k: saved.k, projectedTotal: saved.projectedUsd, actualCost: saved.actualUsd, listCost, missing: [] }) +
  wrongCases(rows, golds)
writeFileSync(`${dir}/summary.md`, md)
console.log(md)
