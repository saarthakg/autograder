import { Schema } from "effect"

/**
 * SLOs and the verdict they produce (D-22). Validated with Schema so a typo
 * in a threshold fails loudly instead of silently passing.
 */
export const SloConfig = Schema.Struct({
  /** Acknowledged by the API but missing or never graded: the invariant, every scenario. */
  lostSubmissions: Schema.Struct({ max: Schema.Int }),
  /** Submits that never got a 2xx after the client's retries. */
  submitsNeverAccepted: Schema.Struct({ max: Schema.Int }),
  /** First attempt, measured from its SCHEDULED send time (P31). */
  submitLatencyMs: Schema.Struct({ p99: Schema.Number }),
  /** First attempts answered 5xx, timed out or failed to connect. 4xx are tracked separately. */
  submitErrorRate: Schema.Struct({ max: Schema.Number }),
  /** graded_at − accepted_at, server clock. */
  timeToGradeSec: Schema.Struct({ p95: Schema.Number, p99: Schema.Number }),
  /** Last grade − last acceptance: how fast the backlog clears after the final submit. */
  drainSec: Schema.Struct({ max: Schema.Number }),
  needsReviewRate: Schema.Struct({ healthy: Schema.Number, chaos: Schema.Number }),
  /** Validity gate: if the generator itself falls behind, the run is INVALID, not PASS or FAIL. */
  generatorLagMs: Schema.Struct({ p99: Schema.Number })
})
export type SloConfig = typeof SloConfig.Type

export const DEFAULT_SLO: SloConfig = Schema.decodeUnknownSync(SloConfig)({
  lostSubmissions: { max: 0 },
  submitsNeverAccepted: { max: 0 },
  submitLatencyMs: { p99: 500 },
  submitErrorRate: { max: 0.001 },
  timeToGradeSec: { p95: 30, p99: 60 },
  drainSec: { max: 300 },
  needsReviewRate: { healthy: 0.01, chaos: 0.05 },
  generatorLagMs: { p99: 250 }
})

type Outcome = "PASS" | "FAIL" | "REPORT"

interface SloResult {
  readonly name: string
  readonly target: string
  readonly actual: string
  readonly outcome: Outcome
}

export interface Measured {
  readonly lost: number
  readonly neverAccepted: number
  readonly submitP99Ms: number | null
  readonly submitErrorRate: number
  readonly ttgP95Sec: number | null
  readonly ttgP99Sec: number | null
  readonly drainSec: number | null
  readonly needsReviewRate: number
  readonly lagP99Ms: number | null
}

const check = (ok: boolean, gated: boolean): Outcome => !gated ? "REPORT" : ok ? "PASS" : "FAIL"
const le = (x: number | null, max: number) => x !== null && x <= max

/**
 * Under chaos the instance is killed on purpose, so latency, error-rate and
 * time-to-grade are reported, not gated. What must still hold: nothing lost,
 * every submit eventually accepted, the backlog drains, few items flagged.
 */
export const evaluate = (slo: SloConfig, m: Measured, chaos: boolean) => {
  const results: Array<SloResult> = [
    { name: "Lost submissions (DB-checked)", target: `= ${slo.lostSubmissions.max}`, actual: String(m.lost), outcome: check(m.lost <= slo.lostSubmissions.max, true) },
    { name: "Submits never accepted (after client retries)", target: `= ${slo.submitsNeverAccepted.max}`, actual: String(m.neverAccepted), outcome: check(m.neverAccepted <= slo.submitsNeverAccepted.max, true) },
    { name: "Submit latency p99 (from scheduled send)", target: `≤ ${slo.submitLatencyMs.p99} ms`, actual: m.submitP99Ms === null ? "–" : `${Math.round(m.submitP99Ms)} ms`, outcome: check(le(m.submitP99Ms, slo.submitLatencyMs.p99), !chaos) },
    { name: "Submit error rate (first attempt, 5xx/timeout)", target: `≤ ${(slo.submitErrorRate.max * 100).toFixed(1)}%`, actual: `${(m.submitErrorRate * 100).toFixed(2)}%`, outcome: check(m.submitErrorRate <= slo.submitErrorRate.max, !chaos) },
    { name: "Time to grade p95", target: `≤ ${slo.timeToGradeSec.p95} s`, actual: m.ttgP95Sec === null ? "–" : `${m.ttgP95Sec.toFixed(1)} s`, outcome: check(le(m.ttgP95Sec, slo.timeToGradeSec.p95), !chaos) },
    { name: "Time to grade p99", target: `≤ ${slo.timeToGradeSec.p99} s`, actual: m.ttgP99Sec === null ? "–" : `${m.ttgP99Sec.toFixed(1)} s`, outcome: check(le(m.ttgP99Sec, slo.timeToGradeSec.p99), !chaos) },
    { name: "Drain after last submit", target: `≤ ${slo.drainSec.max} s`, actual: m.drainSec === null ? "–" : `${m.drainSec.toFixed(1)} s`, outcome: check(le(m.drainSec, slo.drainSec.max), true) },
    {
      name: "Needs-review rate", target: `≤ ${((chaos ? slo.needsReviewRate.chaos : slo.needsReviewRate.healthy) * 100).toFixed(0)}%`,
      actual: `${(m.needsReviewRate * 100).toFixed(2)}%`, outcome: check(m.needsReviewRate <= (chaos ? slo.needsReviewRate.chaos : slo.needsReviewRate.healthy), true)
    }
  ]
  const valid = le(m.lagP99Ms, slo.generatorLagMs.p99)
  const verdict = !valid ? "INVALID" : results.some((r) => r.outcome === "FAIL") ? "NO-SHIP" : "SHIP"
  return { results, valid, verdict, lag: { target: `≤ ${slo.generatorLagMs.p99} ms`, actual: m.lagP99Ms === null ? "–" : `${Math.round(m.lagP99Ms)} ms` } } as const
}
