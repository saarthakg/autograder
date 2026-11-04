import { describe, expect, it } from "vitest"
import { classesToRun, SCENARIOS } from "../src/scenarios.ts"
import { DEFAULT_SLO, evaluate, type Measured } from "../src/slo.ts"
import { percentile } from "../src/stats.ts"
import { buildTimeline, peakRate } from "../src/timeline.ts"

describe("timeline (P30)", () => {
  it("is reproducible, and running at N× speed with 1/N of the classes keeps the real-world arrival rate", () => {
    const real = { ...SCENARIOS["testing-day"]!, speed: 1 }
    const fast = SCENARIOS["testing-day"]!
    expect(buildTimeline(fast)).toEqual(buildTimeline(fast))
    expect(classesToRun(real)).toBe(40)
    expect(classesToRun(fast)).toBe(10)
    const realPeak = peakRate(buildTimeline(real), real.speed)
    const fastPeak = peakRate(buildTimeline(fast), fast.speed)
    // PLAN §8 sizing: about 5 submits/s at testing-day peak; the compressed run lands near it.
    expect(realPeak).toBeGreaterThan(3)
    expect(realPeak).toBeLessThan(9)
    expect(Math.abs(fastPeak - realPeak) / realPeak).toBeLessThan(0.35)
  })

  it("schedules every student's submits in order, after they join", () => {
    for (const p of buildTimeline(SCENARIOS.smoke!)) {
      expect(p.submitAtMs[0]!).toBeGreaterThan(p.joinAtMs)
      expect([...p.submitAtMs].sort((a, b) => a - b)).toEqual(p.submitAtMs)
    }
  })
})

const healthy: Measured = { lost: 0, neverAccepted: 0, submitP99Ms: 300, submitErrorRate: 0, ttgP95Sec: 8, ttgP99Sec: 12, drainSec: 10, needsReviewRate: 0.005, lagP99Ms: 20 }

describe("SLO verdict (D-22)", () => {
  it("SHIP when every gate passes; NO-SHIP on one lost submission; INVALID when the generator lags", () => {
    expect(evaluate(DEFAULT_SLO, healthy, false).verdict).toBe("SHIP")
    expect(evaluate(DEFAULT_SLO, { ...healthy, lost: 1 }, false).verdict).toBe("NO-SHIP")
    expect(evaluate(DEFAULT_SLO, { ...healthy, lagP99Ms: 900 }, false).verdict).toBe("INVALID")
  })

  it("under chaos, latency and errors are reported, not gated, but losing work still fails", () => {
    const crashy = { ...healthy, submitP99Ms: 9_000, submitErrorRate: 0.03, ttgP99Sec: 70 }
    expect(evaluate(DEFAULT_SLO, crashy, true).verdict).toBe("SHIP")
    expect(evaluate(DEFAULT_SLO, crashy, false).verdict).toBe("NO-SHIP")
    expect(evaluate(DEFAULT_SLO, { ...crashy, neverAccepted: 1 }, true).verdict).toBe("NO-SHIP")
  })

  it("percentile is nearest-rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([], 50)).toBeNull()
  })
})
