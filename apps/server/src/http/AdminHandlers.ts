import {
  Api,
  DemoClass,
  FixturesDisabled,
  GradeView,
  JobNotFound,
  JobView,
  RubricGenerationFailed,
  SAMPLE_PROBLEMS,
  SubmissionAccepted,
  SubmissionNotFound,
  SubmissionView
} from "@autograder/domain"
import { DateTime, Effect, FileSystem, Option, Path } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { RubricGenerator } from "../grading/RubricGenerator.ts"
import { Submissions } from "../grading/Submissions.ts"
import { JobQueue, type JobRow } from "../queue/JobQueue.ts"
import { WakeSignal } from "../worker/WakeSignal.ts"

const utc = (d: Date) => DateTime.fromDateUnsafe(d)

const toJobView = (job: JobRow) =>
  new JobView({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    createdAt: utc(job.createdAt),
    claimedAt: job.claimedAt ? utc(job.claimedAt) : null,
    finishedAt: job.finishedAt ? utc(job.finishedAt) : null,
    lastError: job.lastError
  })

interface SubmissionRow {
  readonly id: string
  readonly status: "queued" | "grading" | "graded" | "needs_review"
  readonly reviewReason: "illegible" | "invalid_output" | "grading_failed" | null
  readonly acceptedAt: Date
  readonly gradedAt: Date | null
  readonly totalPoints: number | null
  readonly maxPoints: number | null
  readonly legible: boolean | null
  readonly confidence: "high" | "medium" | "low" | null
  readonly transcription: string | null
  readonly verdicts: ReadonlyArray<{ id: string; met: boolean; evidence: string }> | null
  readonly model: string | null
}

/**
 * Operator endpoints behind ADMIN_TOKEN. In Phase 2 they drive real grading
 * (demo class, submit, read back) and fixture capture; Phase 3's teacher and
 * student endpoints call the same services.
 */
export const AdminHandlers = HttpApiBuilder.group(
  Api,
  "admin",
  Effect.fn(function*(handlers) {
    const config = yield* AppConfig
    const sql = yield* SqlClient.SqlClient
    const queue = yield* JobQueue
    const wake = yield* WakeSignal
    const submissions = yield* Submissions
    const rubrics = yield* RubricGenerator
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return handlers.handleAll({
      enqueueEcho: ({ payload }) =>
        Effect.gen(function*() {
          const { id } = yield* queue.enqueue({ kind: "echo", payload: {}, runId: payload.runId })
          yield* wake.ring
          return toJobView(Option.getOrThrow(yield* queue.get(id)))
        }).pipe(Effect.orDie),

      getJob: ({ params }) =>
        queue.get(params.id).pipe(
          Effect.orDie,
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new JobNotFound({ id: params.id })),
            onSome: (job) => Effect.succeed(toJobView(job))
          }))
        ),

      createDemoClass: () =>
        sql.withTransaction(Effect.gen(function*() {
          const [a] = yield* sql<{ id: string }>`INSERT INTO assignment (title) VALUES ('Algebra 1 sample') RETURNING id`
          const problems: Array<{ id: string; key: string; position: number }> = []
          for (const [index, p] of SAMPLE_PROBLEMS.entries()) {
            const [row] = yield* sql<{ id: string }>`
              INSERT INTO problem (assignment_id, position, prompt_md, answer_key, max_points)
              VALUES (${a!.id}, ${index + 1}, ${p.prompt}, ${p.answerKey}, ${p.maxPoints}) RETURNING id`
            yield* sql`INSERT INTO rubric (problem_id, version, items, reference_solution, source)
                       VALUES (${row!.id}, 1, ${JSON.stringify(p.rubric.items)}::jsonb, ${p.rubric.referenceSolution}, 'sample')`
            problems.push({ id: row!.id, key: p.key, position: index + 1 })
          }
          const [s] = yield* sql<{ id: string }>`
            INSERT INTO student (assignment_id, display_name, rejoin_code, token_hash)
            VALUES (${a!.id}, 'Demo student', 'DEMO01', ${crypto.randomUUID()}) RETURNING id`
          return new DemoClass({ assignmentId: a!.id, studentId: s!.id, problems })
        })).pipe(Effect.orDie),

      submit: ({ payload }) =>
        submissions.submit(payload).pipe(
          Effect.map((r) => new SubmissionAccepted({ id: r.id, status: r.status as SubmissionAccepted["status"], created: r.created })),
          Effect.catchTag("SqlError", Effect.die)
        ),

      getSubmission: ({ params }) =>
        Effect.gen(function*() {
          const rows = yield* sql<SubmissionRow>`
            SELECT s.id, s.status, s.review_reason AS "reviewReason", s.accepted_at AS "acceptedAt", s.graded_at AS "gradedAt",
                   g.total_points AS "totalPoints", g.max_points AS "maxPoints", g.legible, g.confidence,
                   g.transcription, g.verdicts, g.model
            FROM submission s LEFT JOIN grade g ON g.submission_id = s.id
            WHERE s.id::text = ${params.id}
            ORDER BY g.rubric_version DESC NULLS LAST LIMIT 1`
          const r = rows[0]
          if (r === undefined) return yield* new SubmissionNotFound({ id: params.id })
          return new SubmissionView({
            id: r.id,
            status: r.status,
            reviewReason: r.reviewReason,
            acceptedAt: utc(r.acceptedAt),
            gradedAt: r.gradedAt ? utc(r.gradedAt) : null,
            grade: r.totalPoints === null ? null : new GradeView({
              totalPoints: r.totalPoints,
              maxPoints: r.maxPoints!,
              legible: r.legible!,
              confidence: r.confidence!,
              transcription: r.transcription!,
              verdicts: r.verdicts ?? [],
              model: r.model!
            })
          })
        }).pipe(Effect.catchTag("SqlError", Effect.die)),

      generateRubric: ({ payload }) =>
        rubrics.generate(payload).pipe(
          Effect.map((r) => r.rubric),
          Effect.mapError((e) => new RubricGenerationFailed({ message: e.message }))
        ),

      saveFixture: ({ payload }) =>
        Effect.gen(function*() {
          if (Option.isNone(config.fixtureDir)) return yield* new FixturesDisabled({ message: "set FIXTURE_DIR to capture fixtures" })
          if (!/^[a-z0-9-]+$/.test(payload.caseKey)) return yield* new FixturesDisabled({ message: "bad case key" })
          const dir = config.fixtureDir.value
          yield* fs.makeDirectory(dir, { recursive: true })
          const base = path.join(dir, payload.caseKey)
          yield* fs.writeFileString(`${base}.json`, JSON.stringify({ caseKey: payload.caseKey, strokes: payload.strokes, savedAt: new Date().toISOString() }))
          yield* fs.writeFile(`${base}.png`, payload.imagePng)
          return { path: `${base}.png` }
        }).pipe(Effect.catchTag("PlatformError", Effect.die))
    })
  })
)
