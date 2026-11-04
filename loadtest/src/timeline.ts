import type { Scenario } from "./scenarios.ts"
import { classesToRun } from "./scenarios.ts"

/** Seeded PRNG (mulberry32), so a scenario's timeline is reproducible run to run. */
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const lognormal = (random: () => number, median: number, sigma: number) => {
  const u1 = Math.max(1e-12, random())
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random())
  return median * Math.exp(sigma * z)
}

export interface StudentPlan {
  readonly classIndex: number
  readonly studentIndex: number
  /** Offsets from the run's start, in ms of WALL time (already compressed by speed). */
  readonly joinAtMs: number
  readonly submitAtMs: ReadonlyArray<number>
}

/** Precomputes every student's join and submit times (open model: they fire on schedule, P30). */
export const buildTimeline = (s: Scenario, seed = 42): ReadonlyArray<StudentPlan> => {
  const random = rng(seed)
  const classes = classesToRun(s)
  const plans: Array<StudentPlan> = []
  for (let c = 0; c < classes; c++) {
    const classStart = classes === 1 ? 0 : (s.classStartWindowSec * c) / (classes - 1)
    for (let st = 0; st < s.studentsPerClass; st++) {
      const join = classStart + random() * s.joinWindowSec
      let t = join
      const submits: Array<number> = []
      for (let p = 0; p < s.problems; p++) {
        t += lognormal(random, s.thinkMedianSec, s.thinkSigma)
        submits.push(Math.round((t * 1000) / s.speed))
      }
      plans.push({ classIndex: c, studentIndex: st, joinAtMs: Math.round((join * 1000) / s.speed), submitAtMs: submits })
    }
  }
  return plans
}

/** Peak submits/s over a sliding 60 s window of the timeline, converted back to real-world time. */
export const peakRate = (plans: ReadonlyArray<StudentPlan>, speed: number, windowMs = 60_000) => {
  const times = plans.flatMap((p) => p.submitAtMs).sort((a, b) => a - b)
  const w = windowMs / speed
  let best = 0
  let lo = 0
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi]! - times[lo]! > w) lo++
    best = Math.max(best, hi - lo + 1)
  }
  // The server sees best submits in windowMs/speed of wall time: the real-world rate is the same.
  return (best * speed) / (windowMs / 1000)
}
