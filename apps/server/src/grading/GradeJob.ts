import { Rubric } from "@autograder/domain"
import { Duration, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { ModelError } from "../model/ModelClient.ts"
import type { JobRow } from "../queue/JobQueue.ts"
import { JobFailure, type JobHandler } from "../worker/JobHandlers.ts"
import { Grader, type GradeResult } from "./Grader.ts"

const Payload = Schema.Struct({ submissionId: Schema.String })
const decodePayload = Schema.decodeUnknownEffect(Payload)
const decodeRubric = Schema.decodeUnknownEffect(Rubric)

/** When the budget guard trips, wait this long before trying again (P25). */
const BUDGET_RETRY = Duration.minutes(10)

interface Loaded {
  readonly status: string
  readonly image: Uint8Array | null
  readonly runId: string | null
  readonly simulated: boolean
  readonly prompt: string
  readonly answerKey: string | null
  readonly rubricVersion: number
  readonly items: unknown
  readonly referenceSolution: string
}

/**
 * The "grade" job (D-12): load the submission and its current rubric, call the
 * grader, then write the grade and the submission's final status together.
 * Re-running a finished job is a no-op (P23). Every way out ends in a terminal
 * status; nothing is left half-graded (P9).
 */
export const makeGradeHandler = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const grader = yield* Grader

  const markNeedsReview = (submissionId: string, reason: "illegible" | "invalid_output" | "grading_failed") =>
    sql`UPDATE submission
        SET status = 'needs_review', review_reason = ${reason}, graded_at = now(), image = NULL
        WHERE id = ${submissionId} AND status NOT IN ('graded', 'needs_review')`.pipe(Effect.asVoid)

  const writeGrade = (submissionId: string, rubricVersion: number, result: GradeResult) =>
    sql.withTransaction(Effect.gen(function*() {
      const verdicts = result.output.criteria.map((c) => ({ id: c.id, met: c.verdict === "met", evidence: c.evidence }))
      yield* sql`
        INSERT INTO grade (submission_id, rubric_version, model, prompt_version, transcription, legible, confidence,
                           verdicts, total_points, max_points, model_started_at, model_finished_at)
        VALUES (${submissionId}, ${rubricVersion}, ${result.model}, ${result.promptVersion}, ${result.output.transcription},
                ${result.output.legible}, ${result.output.confidence}, ${JSON.stringify(verdicts)}::jsonb,
                ${result.totalPoints}, ${result.maxPoints}, ${result.startedAt}, ${result.finishedAt})
        ON CONFLICT (submission_id, rubric_version) DO NOTHING`
      // An abstention is a legitimate outcome, but it's the teacher's to grade (P9).
      const legible = result.output.legible
      yield* sql`
        UPDATE submission
        SET status = ${legible ? "graded" : "needs_review"}, review_reason = ${legible ? null : "illegible"},
            graded_at = now(), image = NULL
        WHERE id = ${submissionId} AND status NOT IN ('graded', 'needs_review')`
    }))

  const run = (job: JobRow) =>
    Effect.gen(function*() {
      const { submissionId } = yield* decodePayload(job.payload).pipe(
        Effect.mapError(() => new JobFailure({ message: "bad grade job payload", permanent: true }))
      )
      const rows = yield* sql<Loaded>`
        SELECT s.status, s.image, s.run_id AS "runId", a.simulated, p.prompt_md AS prompt, p.answer_key AS "answerKey",
               r.version AS "rubricVersion", r.items, r.reference_solution AS "referenceSolution"
        FROM submission s
        JOIN problem p ON p.id = s.problem_id
        JOIN assignment a ON a.id = p.assignment_id
        JOIN rubric r ON r.problem_id = p.id AND r.version = p.current_rubric_version
        WHERE s.id = ${submissionId}`
      const sub = rows[0]
      if (sub === undefined) return yield* new JobFailure({ message: `submission ${submissionId} not found`, permanent: true })
      if (sub.status === "graded" || sub.status === "needs_review") return // already terminal: idempotent re-run
      if (sub.image === null) return yield* markNeedsReview(submissionId, "grading_failed")
      if (sub.simulated) {
        // The in-process simulator arrives in Phase 4 (D-28); never grade a load-test row with a real model.
        return yield* new JobFailure({ message: "simulated grading not available yet", permanent: true })
      }
      const rubric = yield* decodeRubric({ items: sub.items, referenceSolution: sub.referenceSolution }).pipe(
        Effect.mapError((e) => new JobFailure({ message: `stored rubric is invalid: ${e.message}`, permanent: true }))
      )
      yield* sql`UPDATE submission SET status = 'grading' WHERE id = ${submissionId} AND status = 'queued'`

      const outcome = yield* grader.grade({
        problem: { prompt: sub.prompt, answerKey: sub.answerKey },
        rubric,
        imagePng: sub.image,
        purpose: "grade",
        submissionId,
        runId: sub.runId ?? undefined
      }).pipe(Effect.result)

      if (outcome._tag === "Success") return yield* writeGrade(submissionId, sub.rubricVersion, outcome.success)
      const error = outcome.failure
      if (error._tag === "InvalidModelOutput") return yield* markNeedsReview(submissionId, "invalid_output")
      return yield* failureFor(error)
    }).pipe(
      Effect.catchTag("SqlError", (e) => Effect.fail(new JobFailure({ message: `database: ${e.message}` })))
    )

  const onDead = (job: JobRow, lastError: string) =>
    decodePayload(job.payload).pipe(
      Effect.flatMap(({ submissionId }) => markNeedsReview(submissionId, "grading_failed")),
      Effect.tap(() => Effect.logWarning(`grading gave up: ${lastError}`).pipe(Effect.annotateLogs({ jobId: job.id }))),
      Effect.catch((e) => Effect.logError("could not mark submission needs_review", e))
    )

  return { run, onDead } satisfies JobHandler
})

/** Maps a provider failure to the queue's retry decision (P24, P25). */
export const failureFor = (error: ModelError): Effect.Effect<never, JobFailure> =>
  Effect.fail(
    error.kind === "budget_guard"
      ? new JobFailure({ message: error.message, retryAfter: BUDGET_RETRY })
      : new JobFailure({
        message: `${error.kind}: ${error.message}`,
        permanent: !error.retryable,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter })
      })
  )
