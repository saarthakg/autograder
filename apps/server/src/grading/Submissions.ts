import { AlreadySubmitted, InvalidSubmission, type Strokes } from "@autograder/domain"
import { Context, Effect, Layer } from "effect"
import { SqlClient, SqlError } from "effect/sql"
import { JobQueue } from "../queue/JobQueue.ts"
import { WakeSignal } from "../worker/WakeSignal.ts"

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** Cropped grayscale ink is ~20–60 KB; anything far larger is a client bug (D-13). */
export const MAX_IMAGE_BYTES = 256 * 1024

export interface SubmitInput {
  readonly studentId: string
  readonly problemId: string
  readonly idempotencyKey: string
  readonly strokes: Strokes
  readonly imagePng: Uint8Array
  readonly runId?: string | undefined
}

export const isPng = (bytes: Uint8Array) => PNG_MAGIC.every((b, i) => bytes[i] === b)

/**
 * Accept-and-queue (P8, P24): the submission row and its grading job commit
 * in ONE transaction, so an accepted submission can never exist without a job
 * (P22). A retried request with the same idempotency key returns the original
 * submission instead of creating a second one (P23).
 */
export class Submissions extends Context.Service<Submissions, {
  readonly submit: (input: SubmitInput) => Effect.Effect<
    { readonly id: string; readonly status: string; readonly created: boolean },
    InvalidSubmission | AlreadySubmitted | SqlError.SqlError
  >
}>()("autograder/Submissions") {
  static readonly layer = Layer.effect(
    Submissions,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const queue = yield* JobQueue
      const wake = yield* WakeSignal

      const submit = Effect.fn("Submissions.submit")(function*(input: SubmitInput) {
        if (input.imagePng.byteLength > MAX_IMAGE_BYTES) {
          return yield* new InvalidSubmission({ message: `image is ${input.imagePng.byteLength} bytes; max ${MAX_IMAGE_BYTES}` })
        }
        if (!isPng(input.imagePng)) return yield* new InvalidSubmission({ message: "image must be a PNG" })
        if (input.strokes.length === 0) return yield* new InvalidSubmission({ message: "nothing was drawn" })

        const result = yield* sql.withTransaction(Effect.gen(function*() {
          const inserted = yield* sql<{ id: string; status: string }>`
            INSERT INTO submission (student_id, problem_id, idempotency_key, strokes, image, run_id)
            VALUES (${input.studentId}, ${input.problemId}, ${input.idempotencyKey},
                    ${JSON.stringify(input.strokes)}::jsonb, ${input.imagePng}, ${input.runId ?? null})
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id, status`
          const row = inserted[0]
          if (row !== undefined) {
            yield* queue.enqueue({ kind: "grade", payload: { submissionId: row.id }, dedupeKey: `grade:${row.id}`, runId: input.runId })
            return { id: row.id, status: row.status, created: true }
          }
          const existing = yield* sql<{ id: string; status: string; studentId: string }>`
            SELECT id, status, student_id AS "studentId" FROM submission WHERE idempotency_key = ${input.idempotencyKey}`
          const found = existing[0]
          if (found === undefined || found.studentId !== input.studentId) {
            return yield* new InvalidSubmission({ message: "idempotency key already used" })
          }
          return { id: found.id, status: found.status, created: false }
        })).pipe(
          Effect.catchTag("SqlError", (e): Effect.Effect<never, AlreadySubmitted | SqlError.SqlError> =>
            e.reason._tag === "UniqueViolation" && e.reason.constraint.includes("attempt")
              ? Effect.fail(new AlreadySubmitted({ message: "this problem was already submitted" }))
              : Effect.fail(e))
        )
        // After commit: the job is durable, so a lost ring only delays pickup (D-28).
        if (result.created) yield* wake.ring
        return result
      })

      return Submissions.of({ submit })
    })
  )
}
