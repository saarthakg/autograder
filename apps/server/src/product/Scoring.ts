import type { ReviewQueueReason, RubricItem } from "@autograder/domain"

/**
 * Pure product logic over stored grades and teacher overrides (D-01,
 * D-06). The model's verdicts are suggestions; an override wins; code totals.
 */

export interface StoredVerdict {
  readonly id: string
  readonly met: boolean
  readonly evidence: string
}

interface Effective {
  /** Per criterion: override ?? model verdict ?? null (no verdict yet). */
  readonly met: ReadonlyMap<string, boolean | null>
  /** Null until every criterion has a verdict. */
  readonly score: number | null
  readonly overridden: boolean
}

export const effective = (
  items: ReadonlyArray<Pick<RubricItem, "id" | "points">>,
  model: ReadonlyArray<StoredVerdict> | null,
  overrides: Readonly<Record<string, boolean>>
): Effective => {
  const fromModel = new Map((model ?? []).map((v) => [v.id, v.met]))
  const met = new Map<string, boolean | null>()
  for (const item of items) {
    const o = overrides[item.id]
    met.set(item.id, o !== undefined ? o : fromModel.get(item.id) ?? null)
  }
  const complete = [...met.values()].every((v) => v !== null)
  const score = complete ? items.reduce((s, i) => s + (met.get(i.id) ? i.points : 0), 0) : null
  return { met, score, overridden: Object.keys(overrides).length > 0 }
}

export type SubmissionStatus = "queued" | "grading" | "graded" | "needs_review" | "redo"

/**
 * What a student sees for one submitted problem: a score only when
 * one exists (model-graded, or fully teacher-graded); never a made-up number.
 */
export const studentState = (
  status: SubmissionStatus,
  eff: Effective
): "grading" | "graded" | "teacher_check" | "redo" => {
  if (status === "queued" || status === "grading") return "grading"
  if (status === "redo") return "redo"
  if (status === "graded") return "graded"
  return eff.score !== null ? "graded" : "teacher_check"
}

interface ReviewCandidate {
  readonly status: SubmissionStatus
  readonly reviewReason: string | null
  readonly confidence: "high" | "medium" | "low" | null
  readonly staleRubric: boolean
  readonly overridden: boolean
  readonly score: number | null
}

/**
 * Risk ranking for the review queue: failures and abstentions first, then
 * low/medium-confidence grades, then grades from an older rubric. Anything the
 * teacher already touched, or fully graded by hand, drops out.
 */
export const reviewRisk = (c: ReviewCandidate): { reason: ReviewQueueReason; risk: number } | null => {
  if (c.overridden && c.score !== null) return null
  if (c.status === "needs_review") {
    if (c.reviewReason === "grading_failed") return { reason: "grading_failed", risk: 100 }
    if (c.reviewReason === "invalid_output") return { reason: "invalid_output", risk: 95 }
    return { reason: "illegible", risk: 90 }
  }
  if (c.status !== "graded") return null
  if (c.confidence === "low") return { reason: "low_confidence", risk: 60 }
  if (c.confidence === "medium") return { reason: "medium_confidence", risk: 30 }
  if (c.staleRubric) return { reason: "stale_rubric", risk: 20 }
  return null
}

/** How a submission shows in the teacher's report and drawer. */
export const cellStatus = (status: SubmissionStatus, score: number | null): "grading" | "graded" | "needs_review" | "rewriting" =>
  status === "queued" || status === "grading" ? "grading" :
  status === "redo" ? "rewriting" :
  score !== null ? "graded" : "needs_review"

/** Starter rubric when drafting fails: one criterion for the answer; the teacher refines it. */
export const templateRubric = (answerKey: string | null, maxPoints: number) => ({
  items: [{ id: "c1", label: "Gets the correct answer", description: `Final answer is correct${answerKey ? ` (${answerKey})` : ""}.`, points: maxPoints }],
  referenceSolution: answerKey ?? "Add a reference solution."
})
