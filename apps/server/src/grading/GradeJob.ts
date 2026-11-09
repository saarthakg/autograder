import { Rubric } from "@autograder/domain"
import { Duration, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { ModelError } from "../model/ModelClient.ts"
import type { JobRow } from "../queue/JobQueue.ts"
import { JobFailure, type JobHandler } from "../worker/JobHandlers.ts"
import { Grader, type GradeResult, InvalidModelOutput } from "./Grader.ts"

const Payload = Schema.Struct({ submissionId: Schema.String })
const decodePayload = Schema.decodeUnknownEffect(Payload)
const decodeRubric = Schema.decodeUnknownEffect(Rubric)

/** When the budget guard trips, wait this long before trying again. */
const BUDGET_RETRY = Duration.minutes(10)
/** Unreadable work goes back to the student this many times before the teacher sees it. */
const MAX_ATTEMPTS = 2

interface Loaded {
  readonly status: string
  readonly attempt: number
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
 * The "grade" job: load the submission and its current rubric, grade it, then
 * write the grade and the submission's final status together.
 *
 * Uncertainty is resolved here rather than handed to the teacher:
 * 1. Low confidence, unreadable work, or unusable output is re-graded by the
 *    stronger escalation model.
 * 2. Work that is still unreadable goes back to the student to rewrite clearly.
 * 3. Only a second unreadable attempt, or output neither model could produce,
 *    reaches the teacher.
 *
 * Re-running a finished job is a no-op. Every way out ends in a terminal
 * status; nothing is left half-graded.
 */
export const makeGradeHandler = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const grader = yield* Grader
  const config = yield* AppConfig
  const TERMINAL = ["graded", "needs_review", "redo"]

  const markNeedsReview = (submissionId: string, reason: "illegible" | "invalid_output" | "grading_failed") =>
    sql`UPDATE submission
        SET status = 'needs_review', review_reason = ${reason}, graded_at = now(), image = NULL
        WHERE id = ${submissionId} AND status NOT IN ('graded', 'needs_review', 'redo')`.pipe(Effect.asVoid)

  /** Back to the student: "we couldn't read this one, please rewrite it more clearly". */
  const askForRedo = (submissionId: string) =>
    sql`UPDATE submission
        SET status = 'redo', review_reason = 'illegible', graded_at = now(), image = NULL
        WHERE id = ${submissionId} AND status NOT IN ('graded', 'needs_review', 'redo')`.pipe(Effect.asVoid)

  const writeGrade = (submissionId: string, rubricVersion: number, result: GradeResult) =>
    sql.withTransaction(Effect.gen(function*() {
      const verdicts = result.output.criteria.map((c) => ({ id: c.id, met: c.verdict === "met", evidence: c.evidence }))
      yield* sql`
        INSERT INTO grade (submission_id, rubric_version, model, provider, prompt_version, transcription, legible, confidence,
                           verdicts, total_points, max_points, model_started_at, model_finished_at)
        VALUES (${submissionId}, ${rubricVersion}, ${result.model}, ${result.provider}, ${result.promptVersion}, ${result.output.transcription},
                ${result.output.legible}, ${result.output.confidence}, ${JSON.stringify(verdicts)}::jsonb,
                ${result.totalPoints}, ${result.maxPoints}, ${result.startedAt}, ${result.finishedAt})
        ON CONFLICT (submission_id, rubric_version) DO NOTHING`
      // Reached only after escalation and the student's rewrite: the teacher grades it.
      const legible = result.output.legible
      yield* sql`
        UPDATE submission
        SET status = ${legible ? "graded" : "needs_review"}, review_reason = ${legible ? null : "illegible"},
            graded_at = now(), image = NULL
        WHERE id = ${submissionId} AND status NOT IN ('graded', 'needs_review', 'redo')`
    }))

  const run = (job: JobRow) =>
    Effect.gen(function*() {
      const { submissionId } = yield* decodePayload(job.payload).pipe(
        Effect.mapError(() => new JobFailure({ message: "bad grade job payload", permanent: true }))
      )
      const rows = yield* sql<Loaded>`
        SELECT s.status, s.attempt, s.image, s.run_id AS "runId", a.simulated, p.prompt_md AS prompt, p.answer_key AS "answerKey",
               r.version AS "rubricVersion", r.items, r.reference_solution AS "referenceSolution"
        FROM submission s
        JOIN problem p ON p.id = s.problem_id
        JOIN assignment a ON a.id = p.assignment_id
        JOIN rubric r ON r.problem_id = p.id AND r.version = p.current_rubric_version
        WHERE s.id = ${submissionId}`
      const sub = rows[0]
      if (sub === undefined) return yield* new JobFailure({ message: `submission ${submissionId} not found`, permanent: true })
      if (TERMINAL.includes(sub.status)) return // already terminal: idempotent re-run
      if (sub.image === null) return yield* markNeedsReview(submissionId, "grading_failed")
      const rubric = yield* decodeRubric({ items: sub.items, referenceSolution: sub.referenceSolution }).pipe(
        Effect.mapError((e) => new JobFailure({ message: `stored rubric is invalid: ${e.message}`, permanent: true }))
      )
      yield* sql`UPDATE submission SET status = 'grading' WHERE id = ${submissionId} AND status = 'queued'`

      const input = {
        problem: { prompt: sub.prompt, answerKey: sub.answerKey },
        rubric,
        imagePng: sub.image,
        purpose: "grade" as const,
        simulated: sub.simulated,
        submissionId,
        runId: sub.runId ?? undefined
      }
      // A provider failure on the first call retries the whole job with backoff.
      const first = yield* grader.grade(input).pipe(
        Effect.catch((e): Effect.Effect<GradeResult | InvalidModelOutput, JobFailure> =>
          e instanceof InvalidModelOutput ? Effect.succeed(e) : failureFor(e))
      )
      let chosen: GradeResult | InvalidModelOutput = first
      if (needsEscalation(first)) {
        const second = yield* grader.grade({ ...input, model: config.model.escalationModel }).pipe(Effect.result)
        // Keep the stronger model's answer when it has one; if it errors or is unusable too, keep the first.
        if (second._tag === "Success") chosen = second.success
        else if (second.failure._tag !== "InvalidModelOutput") yield* Effect.logWarning(`escalation failed: ${second.failure.message}`)
      }

      if (chosen instanceof InvalidModelOutput) return yield* markNeedsReview(submissionId, "invalid_output")
      if (!chosen.output.legible && sub.attempt < MAX_ATTEMPTS) return yield* askForRedo(submissionId)
      return yield* writeGrade(submissionId, sub.rubricVersion, chosen)
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

/** Unsure, unreadable or unusable: worth a second opinion from the stronger model. */
const needsEscalation = (r: GradeResult | InvalidModelOutput) =>
  r instanceof InvalidModelOutput || !r.output.legible || r.output.confidence === "low"

/** Maps a provider failure to the queue's retry decision. */
const failureFor = (error: ModelError): Effect.Effect<never, JobFailure> =>
  Effect.fail(
    error.kind === "budget_guard"
      ? new JobFailure({ message: error.message, retryAfter: BUDGET_RETRY })
      : new JobFailure({
        message: `${error.kind}: ${error.message}`,
        permanent: !error.retryable,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter })
      })
  )
