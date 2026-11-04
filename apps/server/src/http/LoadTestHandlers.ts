import { Api, ChaosDisabled, LoadTestClasses, QueueMetrics, RunAnalysis, SAMPLE_PROBLEMS } from "@autograder/domain"
import { DateTime, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { Instance } from "../Instance.ts"
import { SimulatedModel } from "../model/SimulatedModel.ts"
import { newSecret, sha256, shortCode } from "../product/Codes.ts"

const utc = (d: Date | null) => d === null ? null : DateTime.fromDateUnsafe(d)
const num = (x: unknown) => x === null || x === undefined ? null : Number(x)

/**
 * Load-test operator endpoints (D-28). Everything a run creates carries its
 * run_id, so analysis and cleanup are one query each.
 */
export const LoadTestHandlers = HttpApiBuilder.group(
  Api,
  "loadtest",
  Effect.fn(function*(handlers) {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const simulator = yield* SimulatedModel
    const config = yield* AppConfig

    return handlers.handleAll({
      createClasses: ({ payload }) =>
        Effect.gen(function*() {
          const secret = newSecret()
          const [teacher] = yield* sql<{ id: string }>`INSERT INTO teacher (secret_hash, run_id) VALUES (${sha256(secret)}, ${payload.runId}) RETURNING id`
          const classes = yield* Effect.forEach(Array.from({ length: payload.classes }, (_, i) => i), (i) =>
            sql.withTransaction(Effect.gen(function*() {
              const [a] = yield* sql<{ id: string; classCode: string }>`
                INSERT INTO assignment (teacher_id, title, status, class_code, published_at, simulated, run_id)
                VALUES (${teacher!.id}, ${`Load test ${payload.runId} · class ${i + 1}`}, 'open', ${shortCode()}, now(), ${payload.simulated}, ${payload.runId})
                RETURNING id, class_code AS "classCode"`
              // Cycle the reviewed sample problems: their rubrics are real, so grading paths are too.
              for (let position = 1; position <= payload.problems; position++) {
                const p = SAMPLE_PROBLEMS[(position - 1) % SAMPLE_PROBLEMS.length]!
                const [row] = yield* sql<{ id: string }>`
                  INSERT INTO problem (assignment_id, position, prompt_md, answer_key, max_points)
                  VALUES (${a!.id}, ${position}, ${p.prompt}, ${p.answerKey}, ${p.maxPoints}) RETURNING id`
                yield* sql`INSERT INTO rubric (problem_id, version, items, reference_solution, source)
                           VALUES (${row!.id}, 1, ${JSON.stringify(p.rubric.items)}::jsonb, ${p.rubric.referenceSolution}, 'sample')`
              }
              return { assignmentId: a!.id, classCode: a!.classCode, problemCount: payload.problems }
            })).pipe(Effect.retry({ times: 3 })), { concurrency: 4 }) // class-code collisions are rare; retry them
          return new LoadTestClasses({ teacherSecret: secret, classes })
        }).pipe(Effect.orDie),

      metrics: () =>
        Effect.gen(function*() {
          const [m] = yield* sql<{ queued: number; running: number; dead: number; oldest: number | null }>`
            SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
                   count(*) FILTER (WHERE status = 'running')::int AS running,
                   count(*) FILTER (WHERE status = 'dead')::int AS dead,
                   extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued')) AS oldest
            FROM job WHERE status IN ('queued', 'running', 'dead')`
          return new QueueMetrics({
            at: DateTime.nowUnsafe(),
            queued: m!.queued,
            running: m!.running,
            dead: m!.dead,
            oldestQueuedSec: Number(m!.oldest ?? 0),
            instanceId: instance.id,
            uptimeSec: Math.round((Date.now() - instance.startedAt) / 1000),
            simulatorInFlight: simulator.inFlight()
          })
        }).pipe(Effect.orDie),

      analyze: ({ params, payload }) =>
        Effect.gen(function*() {
          const runId = params.runId
          const [totals] = yield* sql<{ submissions: number; nonTerminal: number; firstAccepted: Date | null; lastAccepted: Date | null; lastGraded: Date | null }>`
            SELECT count(*)::int AS submissions,
                   count(*) FILTER (WHERE status IN ('queued', 'grading'))::int AS "nonTerminal",
                   min(accepted_at) AS "firstAccepted", max(accepted_at) AS "lastAccepted", max(graded_at) AS "lastGraded"
            FROM submission WHERE run_id = ${runId}`
          const statuses = yield* sql<{ k: string; n: number }>`SELECT status AS k, count(*)::int AS n FROM submission WHERE run_id = ${runId} GROUP BY status`
          const reasons = yield* sql<{ k: string; n: number }>`
            SELECT review_reason AS k, count(*)::int AS n FROM submission WHERE run_id = ${runId} AND review_reason IS NOT NULL GROUP BY review_reason`
          const [ttg] = yield* sql<{ n: number; p50: unknown; p95: unknown; p99: unknown; max: unknown }>`
            SELECT count(*)::int AS n,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM graded_at - accepted_at)) AS p50,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM graded_at - accepted_at)) AS p95,
                   percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM graded_at - accepted_at)) AS p99,
                   max(extract(epoch FROM graded_at - accepted_at)) AS max
            FROM submission WHERE run_id = ${runId} AND graded_at IS NOT NULL`
          // Every id the API acknowledged must exist (P22). Compared in SQL so thousands of ids are one query.
          const missing = payload.acceptedIds.length === 0 ? [] : yield* sql<{ id: string }>`
            SELECT a.id FROM unnest(${payload.acceptedIds}::text[]) AS a(id)
            WHERE NOT EXISTS (SELECT 1 FROM submission s WHERE s.id::text = a.id)`
          const calls = yield* sql<{ k: string; n: number }>`SELECT outcome AS k, count(*)::int AS n FROM model_call WHERE run_id = ${runId} GROUP BY outcome`
          const [jobs] = yield* sql<{ retries: number; dead: number }>`
            SELECT coalesce(sum(greatest(attempts - 1, 0)), 0)::int AS retries, count(*) FILTER (WHERE status = 'dead')::int AS dead
            FROM job WHERE run_id = ${runId}`
          const buckets = yield* sql<{ t: number; accepted: number; graded: number; ttgP95: unknown }>`
            WITH s AS (SELECT accepted_at, graded_at, (SELECT min(accepted_at) FROM submission WHERE run_id = ${runId}) AS t0
                       FROM submission WHERE run_id = ${runId}),
                 a AS (SELECT floor(extract(epoch FROM accepted_at - t0) / 10)::int * 10 AS t, count(*)::int AS n,
                              percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM graded_at - accepted_at)) AS p95
                       FROM s GROUP BY 1),
                 g AS (SELECT floor(extract(epoch FROM graded_at - t0) / 10)::int * 10 AS t, count(*)::int AS n
                       FROM s WHERE graded_at IS NOT NULL GROUP BY 1)
            SELECT coalesce(a.t, g.t) AS t, coalesce(a.n, 0) AS accepted, coalesce(g.n, 0) AS graded, a.p95 AS "ttgP95"
            FROM a FULL JOIN g ON a.t = g.t ORDER BY 1`
          const record = (rows: ReadonlyArray<{ k: string; n: number }>) => Object.fromEntries(rows.map((r) => [r.k, r.n]))
          return new RunAnalysis({
            runId,
            submissions: totals!.submissions,
            byStatus: record(statuses),
            byReviewReason: record(reasons),
            missing: missing.map((m) => m.id),
            nonTerminal: totals!.nonTerminal,
            timeToGradeSec: { n: ttg!.n, p50: num(ttg!.p50), p95: num(ttg!.p95), p99: num(ttg!.p99), max: num(ttg!.max) },
            firstAcceptedAt: utc(totals!.firstAccepted),
            lastAcceptedAt: utc(totals!.lastAccepted),
            lastGradedAt: utc(totals!.lastGraded),
            modelCalls: record(calls),
            jobRetries: jobs!.retries,
            deadJobs: jobs!.dead,
            timeline: buckets.map((b) => ({ t: b.t, accepted: b.accepted, graded: b.graded, ttgP95: num(b.ttgP95) }))
          })
        }).pipe(Effect.orDie),

      deleteRun: ({ params }) =>
        sql.withTransaction(Effect.gen(function*() {
          const modelCalls = yield* sql`DELETE FROM model_call WHERE run_id = ${params.runId} RETURNING 1`
          const jobs = yield* sql`DELETE FROM job WHERE run_id = ${params.runId} RETURNING 1`
          // Cascades to problems, rubrics, students, submissions, grades and overrides.
          const assignments = yield* sql`DELETE FROM assignment WHERE run_id = ${params.runId} RETURNING 1`
          const teachers = yield* sql`DELETE FROM teacher WHERE run_id = ${params.runId} RETURNING 1`
          return { assignments: assignments.length, teachers: teachers.length, jobs: jobs.length, modelCalls: modelCalls.length }
        })).pipe(Effect.orDie),

      deleteLegacyDemoClasses: () =>
        sql`DELETE FROM assignment WHERE teacher_id IS NULL AND run_id IS NULL RETURNING 1`.pipe(
          Effect.map((rows) => ({ assignments: rows.length })),
          Effect.orDie
        ),

      crash: () =>
        Effect.gen(function*() {
          if (!config.chaosEnabled) return yield* new ChaosDisabled({ message: "not found" })
          yield* Effect.logWarning("chaos: crash requested; exiting without graceful shutdown")
          // Answer first, then die hard: in-flight requests and leased jobs on this instance are cut off.
          setTimeout(() => process.exit(137), 200)
          return { instanceId: instance.id }
        })
    })
  })
)
