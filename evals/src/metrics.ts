/**
 * Eval metrics (P17, D-19 as amended). Pure functions; the runner feeds them
 * samples, one per (model, case, run).
 */

export interface Interval {
  /** Point estimate, pooled over all runs. */
  readonly p: number
  /** Wilson 95% interval, using the number of distinct CASES as n (see `rate`). */
  readonly low: number
  readonly high: number
  /** Distinct cases behind the estimate. */
  readonly n: number
}

/** Wilson score interval: honest at small n and near 0% or 100% (~20 cases means one case is ~5 points). */
export const wilson = (p: number, n: number, z = 1.96): { low: number; high: number } => {
  if (n === 0) return { low: 0, high: 1 }
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

export type Outcome = "graded" | "abstained" | "invalid" | "error"

export interface Sample {
  readonly caseKey: string
  readonly run: number
  readonly outcome: Outcome
  /** Per-criterion verdicts in rubric order (graded only). */
  readonly met?: ReadonlyArray<boolean> | undefined
  readonly total?: number | undefined
  /** True when the first model answer was already valid (no corrective retry). */
  readonly firstAttemptValid: boolean
  /** At live list price from measured tokens: the basis for comparing models. */
  readonly costUsd: number
  /** What OpenRouter actually billed (may be 0 during promotions). */
  readonly billedUsd?: number | undefined
  readonly latencyMs: number
  /** What the model read, for error analysis: most LLM grading errors are reading errors (§1.3). */
  readonly transcription?: string | undefined
  readonly evidence?: ReadonlyArray<string> | undefined
  readonly confidence?: string | undefined
  readonly error?: string | undefined
}

export interface Gold {
  readonly key: string
  readonly expect: ReadonlyArray<0 | 1> | "abstain"
  readonly weights: ReadonlyArray<number>
}

const goldTotal = (g: Gold) =>
  g.expect === "abstain" ? 0 : g.expect.reduce<number>((s, v, i) => s + v * (g.weights[i] ?? 0), 0)
const goldMax = (g: Gold) => g.weights.reduce((s, w) => s + w, 0)

/**
 * A rate pooled over every run of the included cases. Runs of the same case
 * are correlated, so the CI uses the number of distinct cases as n. That's
 * conservative: we don't claim certainty we haven't earned.
 */
const rate = (samples: ReadonlyArray<Sample>, include: (s: Sample) => boolean, success: (s: Sample) => boolean): Interval => {
  const pool = samples.filter(include)
  const n = new Set(pool.map((s) => s.caseKey)).size
  const p = pool.length === 0 ? 0 : pool.filter(success).length / pool.length
  return { p, n, ...wilson(p, n) }
}

const percentile = (values: ReadonlyArray<number>, q: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
}

export interface Metrics {
  readonly samples: number
  readonly criterionAccuracy: Interval
  readonly exactTotal: Interval
  readonly withinOne: Interval
  readonly mae: number
  readonly falseFullCredit: Interval
  readonly falseZero: Interval
  readonly abstentionCorrect: Interval
  readonly falseAbstention: Interval
  readonly schemaValid: Interval
  readonly firstAttemptValid: Interval
  readonly flipRate: Interval
  readonly providerErrors: number
  readonly latencyP50Ms: number
  readonly latencyP95Ms: number
  readonly costPerGradeUsd: number
}

export const computeMetrics = (samples: ReadonlyArray<Sample>, golds: ReadonlyArray<Gold>, callLatenciesMs: ReadonlyArray<number>): Metrics => {
  const gold = new Map(golds.map((g) => [g.key, g]))
  const g = (s: Sample) => gold.get(s.caseKey)!
  const legible = (s: Sample) => g(s).expect !== "abstain"
  const answered = (s: Sample) => s.outcome !== "error" // provider errors aren't the model's judgment
  const graded = (s: Sample) => s.outcome === "graded"

  // Exact/within-one: an abstention is CORRECT on unreadable gold (D-19 amendment) and wrong on legible gold.
  const exact = (s: Sample) => legible(s) ? graded(s) && s.total === goldTotal(g(s)) : s.outcome === "abstained"
  const withinOne = (s: Sample) => legible(s) ? graded(s) && Math.abs((s.total ?? -99) - goldTotal(g(s))) <= 1 : s.outcome === "abstained"

  // Criterion accuracy: every criterion of every legible case; a non-graded sample gets all its criteria wrong.
  const criterionSamples: Array<Sample> = []
  const criterionHits: Array<boolean> = []
  for (const s of samples.filter((s) => legible(s) && answered(s))) {
    const expect = g(s).expect as ReadonlyArray<0 | 1>
    expect.forEach((v, i) => {
      criterionSamples.push(s)
      criterionHits.push(graded(s) && s.met?.[i] === (v === 1))
    })
  }
  const criterionN = new Set(criterionSamples.map((s) => s.caseKey)).size
  const criterionP = criterionHits.length === 0 ? 0 : criterionHits.filter(Boolean).length / criterionHits.length

  const gradedLegible = samples.filter((s) => legible(s) && graded(s))
  const mae = gradedLegible.length === 0 ? 0 :
    gradedLegible.reduce((sum, s) => sum + Math.abs((s.total ?? 0) - goldTotal(g(s))), 0) / gradedLegible.length

  // Flip rate (self-consistency): does the case's outcome (total, or "abstain") change across runs?
  const byCase = new Map<string, Set<string>>()
  for (const s of samples.filter(answered)) {
    const label = s.outcome === "graded" ? `t${s.total}` : s.outcome
    byCase.set(s.caseKey, (byCase.get(s.caseKey) ?? new Set()).add(label))
  }
  const multiRun = [...byCase.keys()].filter((k) => samples.filter((s) => s.caseKey === k && answered(s)).length > 1)
  const flips = multiRun.filter((k) => byCase.get(k)!.size > 1).length
  const flipP = multiRun.length === 0 ? 0 : flips / multiRun.length

  return {
    samples: samples.length,
    criterionAccuracy: { p: criterionP, n: criterionN, ...wilson(criterionP, criterionN) },
    exactTotal: rate(samples, answered, exact),
    withinOne: rate(samples, answered, withinOne),
    mae,
    // FFC only over gold cases that are NOT full credit (D-19 amendment); FZ only over gold cases that are not 0.
    falseFullCredit: rate(samples, (s) => answered(s) && legible(s) && goldTotal(g(s)) < goldMax(g(s)), (s) => graded(s) && s.total === goldMax(g(s))),
    falseZero: rate(samples, (s) => answered(s) && legible(s) && goldTotal(g(s)) > 0, (s) => graded(s) && s.total === 0),
    abstentionCorrect: rate(samples, (s) => answered(s) && !legible(s), (s) => s.outcome === "abstained"),
    falseAbstention: rate(samples, (s) => answered(s) && legible(s), (s) => s.outcome === "abstained"),
    schemaValid: rate(samples, answered, (s) => s.outcome !== "invalid"),
    firstAttemptValid: rate(samples, answered, (s) => s.firstAttemptValid),
    flipRate: { p: flipP, n: multiRun.length, ...wilson(flipP, multiRun.length) },
    providerErrors: samples.filter((s) => s.outcome === "error").length,
    latencyP50Ms: percentile(callLatenciesMs, 0.5),
    latencyP95Ms: percentile(callLatenciesMs, 0.95),
    costPerGradeUsd: samples.length === 0 ? 0 : samples.reduce((sum, s) => sum + s.costUsd, 0) / samples.length
  }
}

export interface GateResult {
  readonly name: string
  readonly value: number
  readonly threshold: string
  readonly pass: boolean
  /** The CI straddles the threshold: the pass/fail call rests on very few cases. */
  readonly uncertain: boolean
}

/** The acceptance bar Saarthak approved (D-19 + amendments). */
export const gates = (m: Metrics): ReadonlyArray<GateResult> => {
  const atLeast = (name: string, i: Interval, t: number): GateResult =>
    ({ name, value: i.p, threshold: `≥ ${t * 100}%`, pass: i.p >= t, uncertain: i.low < t && i.high >= t })
  const atMost = (name: string, i: Interval, t: number): GateResult =>
    ({ name, value: i.p, threshold: `≤ ${t * 100}%`, pass: i.p <= t, uncertain: i.low <= t && i.high > t })
  return [
    atLeast("exact total", m.exactTotal, 0.85),
    atLeast("within one point", m.withinOne, 0.95),
    atMost("false full credit", m.falseFullCredit, 0.03),
    atMost("false zero", m.falseZero, 0.03),
    atLeast("schema-valid", m.schemaValid, 0.99),
    atMost("flip rate (k=3)", m.flipRate, 0.05),
    { name: "p95 latency", value: m.latencyP95Ms, threshold: "≤ 15 s", pass: m.latencyP95Ms <= 15_000, uncertain: false }
  ]
}
