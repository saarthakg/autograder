/**
 * Testing-day shapes (D-22). A scenario describes REAL-WORLD load;
 * `speed` compresses think time and bell-schedule stagger so a run takes
 * minutes, and the generator runs 1/speed of the classes so the arrival
 * rate (submits/s) matches the real-world scenario. Each student then
 * submits `speed`× faster, so total polling stays about the same too.
 */
export interface Scenario {
  readonly name: string
  readonly description: string
  /** Real-world classes of `studentsPerClass`. */
  readonly classes: number
  readonly studentsPerClass: number
  readonly problems: number
  /** Class start times spread uniformly over this window (bell schedules differ by school). */
  readonly classStartWindowSec: number
  /** Students join within this many seconds of their class starting. */
  readonly joinWindowSec: number
  /** Lognormal think time per problem: median and sigma (mean ≈ 215 s, so 10 problems ≈ 36 min). */
  readonly thinkMedianSec: number
  readonly thinkSigma: number
  readonly speed: number
  /** Real model calls (canary) instead of the simulator. */
  readonly realModel: boolean
  /** Crash the serving instance at this fraction of the submit timeline. */
  readonly crashAt?: number
}

const base = { studentsPerClass: 30, joinWindowSec: 120, thinkMedianSec: 180, thinkSigma: 0.6, realModel: false } as const

export const SCENARIOS: Record<string, Scenario> = {
  smoke: {
    ...base, name: "smoke", description: "1 class × 3 problems, 10× speed, about 2 minutes: does the pipeline work end to end?",
    classes: 1, problems: 3, classStartWindowSec: 0, speed: 10
  },
  "testing-day": {
    ...base, name: "testing-day",
    description: "Expected load: 40 classes (1,200 students) × 10 problems, class starts staggered over 15 minutes. Run at 4× speed with 10 classes: same submits/s.",
    classes: 40, problems: 10, classStartWindowSec: 900, speed: 4
  },
  spike: {
    ...base, name: "spike",
    description: "Whole district at 9:00: 100 classes (3,000 students) start together and join within 60 s, so first-problem submits cluster. Run at 4× speed with 25 classes.",
    classes: 100, problems: 10, classStartWindowSec: 0, joinWindowSec: 60, speed: 4
  },
  chaos: {
    ...base, name: "chaos",
    description: "testing-day with the serving instance killed abruptly 40% of the way through (the one chaos check, D-28).",
    classes: 40, problems: 10, classStartWindowSec: 900, speed: 4, crashAt: 0.4
  },
  step: {
    ...base, name: "step",
    description: "Breakpoint step: testing-day's peak rate held for about 3.5 minutes (no stagger, 10× speed). Use --scale K for K× the load.",
    classes: 40, problems: 10, classStartWindowSec: 0, speed: 10
  },
  canary: {
    ...base, name: "canary",
    description: "Calibration (D-23): 50 REAL model calls through the deployed path as a burst at testing-day peak (about 5 submits/s for 10 s), behind the budget guard.",
    classes: 1, studentsPerClass: 50, problems: 1, classStartWindowSec: 0, joinWindowSec: 10, thinkMedianSec: 5, thinkSigma: 0, speed: 1, realModel: true
  }
}

/** Real-world peak arrival rate implied by a scenario, for the report's "equivalent to" line. */
export const classesToRun = (s: Scenario) => Math.max(1, Math.round(s.classes / s.speed))
