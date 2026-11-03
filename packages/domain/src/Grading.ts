import { Schema } from "effect"

/**
 * Rubrics and grading (P3, P13, D-11). The model judges each criterion as
 * met / not met; code owns ids, points, totals and statuses.
 */

export const CriterionId = Schema.String.check(Schema.isPattern(/^c[1-6]$/))

export class RubricItem extends Schema.Class<RubricItem>("RubricItem")({
  id: CriterionId,
  /** Student-safe, task-framed: shown as "✓ <label>" when met (D-01). */
  label: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(60)),
  /** What earns it: one atomic, independently checkable fact (D-11 condition 1). */
  description: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(300)),
  /** Weight applied by code, never shown to the model (D-11 condition 2). */
  points: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }))
}) {}

export class Rubric extends Schema.Class<Rubric>("Rubric")({
  items: Schema.Array(RubricItem).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
  referenceSolution: Schema.String.check(Schema.isNonEmpty())
}) {}

/** Problem-level rules the schema alone can't express. Empty list = valid. */
export const rubricProblems = (rubric: Rubric, maxPoints: number): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const ids = rubric.items.map((i) => i.id)
  if (new Set(ids).size !== ids.length) problems.push("criterion ids must be unique")
  const total = rubric.items.reduce((sum, i) => sum + i.points, 0)
  if (total !== maxPoints) problems.push(`criterion points sum to ${total}, but the problem is worth ${maxPoints}`)
  return problems
}

// ---------------------------------------------------------------------------
// Model output: what the grading model must return (structured output).
// Field order matters: the transcription comes first so the model commits to
// what it read before it judges (§1.3).
// ---------------------------------------------------------------------------

export const Verdict = Schema.Literals(["met", "not_met"])
export type Verdict = typeof Verdict.Type

export const Confidence = Schema.Literals(["high", "medium", "low"])
export type Confidence = typeof Confidence.Type

export class CriterionVerdict extends Schema.Class<CriterionVerdict>("CriterionVerdict")({
  id: Schema.String,
  verdict: Verdict,
  evidence: Schema.String.check(Schema.isMaxLength(240))
}) {}

export class GradeOutput extends Schema.Class<GradeOutput>("GradeOutput")({
  transcription: Schema.String,
  /** false = the model abstains; the submission goes to the teacher (P9). */
  legible: Schema.Boolean,
  criteria: Schema.Array(CriterionVerdict),
  confidence: Confidence
}) {}

// ---------------------------------------------------------------------------
// Scoring: pure functions, the only place totals are computed (P13).
// ---------------------------------------------------------------------------

export type VerdictCheck =
  | { readonly _tag: "Valid"; readonly met: ReadonlyMap<string, boolean> }
  | { readonly _tag: "Invalid"; readonly reason: string }

/** Every rubric criterion judged exactly once, nothing extra. */
export const checkVerdicts = (rubric: Rubric, output: GradeOutput): VerdictCheck => {
  const expected = new Set(rubric.items.map((i) => i.id))
  const seen = new Map<string, boolean>()
  for (const c of output.criteria) {
    if (!expected.has(c.id)) return { _tag: "Invalid", reason: `unknown criterion id "${c.id}"` }
    if (seen.has(c.id)) return { _tag: "Invalid", reason: `criterion "${c.id}" judged twice` }
    seen.set(c.id, c.verdict === "met")
  }
  const missing = [...expected].filter((id) => !seen.has(id))
  if (missing.length > 0 && output.legible) {
    return { _tag: "Invalid", reason: `missing verdicts for ${missing.join(", ")}` }
  }
  // An abstention (legible=false) may omit verdicts; none of them count.
  return { _tag: "Valid", met: seen }
}

export const totalPoints = (rubric: Rubric, met: ReadonlyMap<string, boolean>): number =>
  rubric.items.reduce((sum, item) => sum + (met.get(item.id) === true ? item.points : 0), 0)

export const maxPoints = (rubric: Rubric): number => rubric.items.reduce((sum, i) => sum + i.points, 0)
