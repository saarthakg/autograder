import { describe, expect, it } from "@effect/vitest"
import { computeMetrics, gates, type Gold, type Sample, wilson } from "../src/metrics.ts"

const golds: Array<Gold> = [
  { key: "a", expect: [1, 1, 1], weights: [1, 1, 2] },
  { key: "b", expect: [1, 1, 0], weights: [1, 1, 2] },
  { key: "u", expect: "abstain", weights: [1, 1, 2] }
]
const s = (caseKey: string, run: number, outcome: Sample["outcome"], met?: Array<boolean>, total?: number): Sample => ({
  caseKey, run, outcome, met, total, firstAttemptValid: true, costUsd: 0.001, latencyMs: 1000
})

describe("wilson", () => {
  it("matches known values and stays inside [0, 1]", () => {
    const w = wilson(0.5, 20)
    expect(w.low).toBeCloseTo(0.299, 2)
    expect(w.high).toBeCloseTo(0.701, 2)
    expect(wilson(1, 20).high).toBe(1)
    expect(wilson(0, 20).low).toBe(0)
    expect(wilson(0, 20).high).toBeGreaterThan(0.15) // 0/20 still allows a real failure rate of ~16%
  })
})

describe("computeMetrics", () => {
  it("scores a perfect grader as perfect, abstention on unreadable work included", () => {
    const samples = [1, 2, 3].flatMap((run) => [
      s("a", run, "graded", [true, true, true], 4),
      s("b", run, "graded", [true, true, false], 2),
      s("u", run, "abstained")
    ])
    const m = computeMetrics(samples, golds, [800, 900, 1000])
    expect(m.exactTotal.p).toBe(1)
    expect(m.criterionAccuracy.p).toBe(1)
    expect(m.abstentionCorrect.p).toBe(1)
    expect(m.flipRate.p).toBe(0)
    expect(gates(m).every((g) => g.pass)).toBe(true)
  })

  it("counts false full credit only over gold cases that aren't full credit", () => {
    const m = computeMetrics([s("a", 1, "graded", [true, true, true], 4), s("b", 1, "graded", [true, true, true], 4)], golds, [1])
    expect(m.falseFullCredit.p).toBe(1) // 1 of 1 eligible case (b); a is excluded
    expect(m.falseFullCredit.n).toBe(1)
  })

  it("treats abstaining on legible work as an error, and flags flips across runs", () => {
    const m = computeMetrics([
      s("a", 1, "graded", [true, true, true], 4),
      s("a", 2, "abstained"),
      s("a", 3, "graded", [true, true, true], 4)
    ], golds, [1])
    expect(m.falseAbstention.p).toBeCloseTo(1 / 3)
    expect(m.flipRate.p).toBe(1)
  })

  it("excludes provider errors from judgment metrics but counts them", () => {
    const m = computeMetrics([s("a", 1, "error"), s("a", 2, "graded", [true, true, true], 4)], golds, [1])
    expect(m.providerErrors).toBe(1)
    expect(m.exactTotal.p).toBe(1)
  })
})
