import type { ModelInfo } from "../../apps/server/src/model/ModelClient.ts"
import type { GateResult, Gold, Metrics, Sample } from "./metrics.ts"

export const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 3)}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
// A rate with no eligible cases is "n/a", not a misleading 0%.
const ci = (i: { p: number; low: number; high: number; n: number }) => i.n === 0 ? "n/a" : `${pct(i.p)} [${pct(i.low)}–${pct(i.high)}]`

/** Cost of one call at the model's live list price, from its measured token usage. */
export const listPriceUsd = (
  price: Pick<ModelInfo, "promptPrice" | "completionPrice">,
  call: { readonly inputTokens?: number | null | undefined; readonly outputTokens?: number | null | undefined }
) => (call.inputTokens ?? 0) * price.promptPrice + (call.outputTokens ?? 0) * price.completionPrice

export interface ModelRow {
  readonly model: string
  readonly role: string
  readonly metrics: Metrics
  readonly gates: ReadonlyArray<GateResult>
  readonly samples: ReadonlyArray<Sample>
}

/** Cheapest cheap model that clears every gate; otherwise the best one, said plainly (D-19 amendment). */
export const recommend = (rows: ReadonlyArray<ModelRow>) => {
  const cheapRows = rows.filter((m) => m.role === "cheap")
  const passing = cheapRows.filter((m) => m.gates.every((g) => g.pass)).sort((a, b) => a.metrics.costPerGradeUsd - b.metrics.costPerGradeUsd)
  const best = [...cheapRows].sort((a, b) =>
    b.gates.filter((g) => g.pass).length - a.gates.filter((g) => g.pass).length ||
    b.metrics.exactTotal.p - a.metrics.exactTotal.p ||
    a.metrics.costPerGradeUsd - b.metrics.costPerGradeUsd
  )[0]!
  return passing[0]
    ? { model: passing[0].model, clearsBar: true, note: "cheapest cheap model (at list price) that clears every gate" }
    : { model: best.model, clearsBar: false, note: `no cheap model cleared every gate; best is ${best.model}, missing: ${best.gates.filter((g) => !g.pass).map((g) => g.name).join(", ")}` }
}

/** Every sample whose total (or abstention) disagrees with gold, with what the model read. */
export const wrongCases = (
  rows: ReadonlyArray<{ model: string; samples: ReadonlyArray<Sample> }>,
  golds: ReadonlyArray<Gold>
) => {
  const out = ["", "## Wrong cases", "", "Each miss with the model's transcription, to tell misreads (bad transcription) from misjudgments (good transcription, wrong verdict).", ""]
  for (const r of rows) {
    const misses = r.samples.filter((s) => {
      const g = golds.find((x) => x.key === s.caseKey)!
      if (g.expect === "abstain") return s.outcome !== "abstained"
      const total = g.expect.reduce<number>((sum, v, i) => sum + v * g.weights[i]!, 0)
      return s.outcome !== "graded" || s.total !== total
    })
    out.push(`### ${r.model} (${misses.length} of ${r.samples.length} samples)`, "")
    for (const s of misses) {
      const g = golds.find((x) => x.key === s.caseKey)!
      const gold = g.expect === "abstain" ? "abstain" : `${g.expect.join("")} (${g.expect.reduce<number>((sum, v, i) => sum + v * g.weights[i]!, 0)} pts)`
      const got = s.outcome === "graded" ? `${s.met?.map((m) => (m ? 1 : 0)).join("")} (${s.total} pts)` : s.outcome
      const read = (s.transcription ?? s.error ?? "").replace(/\s+/g, " ").slice(0, 160)
      out.push(`- \`${s.caseKey}\` run ${s.run}: gold ${gold}, got ${got}. Read: "${read}"`)
    }
    out.push("")
  }
  return out.join("\n")
}

export const summary = (
  rows: ReadonlyArray<{ model: string; role: string; metrics: Metrics; gates: ReadonlyArray<{ name: string; pass: boolean; uncertain: boolean }> }>,
  rec: { model: string; clearsBar: boolean; note: string },
  meta: { ready: number; k: number; projectedTotal: number; actualCost: number; listCost: number; missing: ReadonlyArray<string> }
) => {
  const lines = [
    `# Eval results`,
    ``,
    `${meta.ready} gold cases × k=${meta.k} runs per model, grade.v2 prompt. Projected ${usd(meta.projectedTotal)}; billed by OpenRouter ${usd(meta.actualCost)}; at list price ${usd(meta.listCost)}. Cost / grade below is at list price from measured tokens.`,
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

