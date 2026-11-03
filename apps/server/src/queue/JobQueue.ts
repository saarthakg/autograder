import { JobId, JobStatus } from "@autograder/domain"
import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlError } from "effect/sql"

/**
 * Durable job queue on Postgres (D-12, P22). Every operation is ONE SQL
 * statement, so it behaves the same through Neon's transaction-mode pooler
 * (D-20 A4). `attempts` doubles as a fencing token: a worker whose lease
 * expired and was re-claimed elsewhere can no longer complete or retry it.
 */

export class JobRow extends Schema.Class<JobRow>("JobRow")({
  id: JobId,
  kind: Schema.String,
  payload: Schema.Unknown,
  status: JobStatus,
  attempts: Schema.Int,
  maxAttempts: Schema.Int,
  runId: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  claimedAt: Schema.NullOr(Schema.Date),
  finishedAt: Schema.NullOr(Schema.Date),
  lastError: Schema.NullOr(Schema.String)
}) {}

export interface EnqueueInput {
  readonly kind: string
  readonly payload: unknown
  /** Same key twice enqueues once (P23). */
  readonly dedupeKey?: string | undefined
  readonly runId?: string | undefined
  readonly maxAttempts?: number | undefined
}

export type RetryOutcome = "retrying" | "dead" | "lost"

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(JobRow))
const columns = `id, kind, payload, status, attempts, max_attempts AS "maxAttempts", run_id AS "runId",
  created_at AS "createdAt", claimed_at AS "claimedAt", finished_at AS "finishedAt", last_error AS "lastError"`

export class JobQueue extends Context.Service<JobQueue, {
  readonly enqueue: (input: EnqueueInput) => Effect.Effect<{ readonly id: JobId; readonly created: boolean }, SqlError.SqlError>
  /** Claims the oldest due job if the global in-flight budget allows (D-12). */
  readonly claim: (options: {
    readonly lease: Duration.Duration
    readonly maxInFlightGlobal: number
  }) => Effect.Effect<Option.Option<JobRow>, SqlError.SqlError>
  readonly complete: (job: JobRow) => Effect.Effect<boolean, SqlError.SqlError>
  /** `permanent` buries immediately, for failures that cannot succeed on retry. */
  readonly retryOrBury: (
    job: JobRow,
    error: string,
    delay: Duration.Duration,
    options?: { readonly permanent?: boolean }
  ) => Effect.Effect<RetryOutcome, SqlError.SqlError>
  /** Re-queues (or buries, if out of attempts) jobs whose worker died (P22). */
  readonly sweepExpired: Effect.Effect<number, SqlError.SqlError>
  /** Earliest moment something becomes actionable: a due retry or an expiring lease. */
  readonly nextDueAt: Effect.Effect<Option.Option<Date>, SqlError.SqlError>
  readonly get: (id: JobId) => Effect.Effect<Option.Option<JobRow>, SqlError.SqlError>
}>()("autograder/JobQueue") {
  static readonly layer = Layer.effect(
    JobQueue,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      // Decode failures mean our own SQL and schema disagree: a bug, not a runtime condition.
      const rows = (effect: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>) =>
        effect.pipe(Effect.flatMap((r) => decodeRows(r).pipe(Effect.orDie)))

      const enqueue = Effect.fn("JobQueue.enqueue")(function*(input: EnqueueInput) {
        const inserted = yield* rows(sql.unsafe(
          `INSERT INTO job (kind, payload, dedupe_key, run_id, max_attempts)
           VALUES ($1, $2::jsonb, $3, $4, $5)
           ON CONFLICT (dedupe_key) DO NOTHING
           RETURNING ${columns}`,
          [input.kind, JSON.stringify(input.payload ?? {}), input.dedupeKey ?? null, input.runId ?? null, input.maxAttempts ?? 5]
        ))
        const first = inserted[0]
        if (first !== undefined) return { id: first.id, created: true }
        // Only reachable with a dedupe key: the job already exists.
        const existing = yield* rows(sql.unsafe(`SELECT ${columns} FROM job WHERE dedupe_key = $1`, [input.dedupeKey ?? null]))
        const found = existing[0]
        if (found === undefined) return yield* Effect.die(new Error("enqueue: conflict without an existing row"))
        return { id: found.id, created: false }
      })

      const claim = Effect.fn("JobQueue.claim")(function*(options: {
        readonly lease: Duration.Duration
        readonly maxInFlightGlobal: number
      }) {
        const claimed = yield* rows(sql.unsafe(
          `WITH capacity AS (
             SELECT GREATEST($1::int - count(*), 0) AS free
             FROM job WHERE status = 'running' AND lease_until > now()
           ), next AS (
             SELECT id AS next_id FROM job
             WHERE status = 'queued' AND run_after <= now()
             ORDER BY run_after
             LIMIT (SELECT LEAST(free, 1) FROM capacity)
             FOR UPDATE SKIP LOCKED
           )
           UPDATE job SET status = 'running', attempts = job.attempts + 1, claimed_at = now(),
             lease_until = now() + make_interval(secs => $2::double precision)
           FROM next WHERE job.id = next.next_id
           RETURNING ${columns}`,
          [options.maxInFlightGlobal, Duration.toSeconds(options.lease)]
        ))
        return Option.fromNullishOr(claimed[0])
      })

      const complete = Effect.fn("JobQueue.complete")(function*(job: JobRow) {
        const done = yield* sql.unsafe(
          `UPDATE job SET status = 'done', finished_at = now(), lease_until = NULL
           WHERE id = $1 AND status = 'running' AND attempts = $2 RETURNING id`,
          [job.id, job.attempts]
        )
        return done.length === 1
      })

      const retryOrBury = Effect.fn("JobQueue.retryOrBury")(function*(
        job: JobRow,
        error: string,
        delay: Duration.Duration,
        options?: { readonly permanent?: boolean }
      ) {
        const result = yield* sql.unsafe<{ status: string }>(
          `UPDATE job SET
             status = CASE WHEN $5 OR attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
             finished_at = CASE WHEN $5 OR attempts >= max_attempts THEN now() END,
             run_after = now() + make_interval(secs => $3::double precision),
             lease_until = NULL, last_error = $4
           WHERE id = $1 AND status = 'running' AND attempts = $2 RETURNING status`,
          [job.id, job.attempts, Duration.toSeconds(delay), error.slice(0, 2000), options?.permanent === true]
        )
        const row = result[0]
        return row === undefined ? "lost" : row.status === "dead" ? "dead" : "retrying"
      })

      const sweepExpired = sql.unsafe(
        `UPDATE job SET
           status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
           finished_at = CASE WHEN attempts >= max_attempts THEN now() END,
           run_after = now(), lease_until = NULL, last_error = 'lease expired (worker stopped mid-job)'
         WHERE status = 'running' AND lease_until < now() RETURNING id`
      ).pipe(Effect.map((r) => r.length), Effect.withSpan("JobQueue.sweepExpired"))

      const nextDueAt = sql.unsafe<{ at: Date | null }>(
        `SELECT LEAST(
           (SELECT min(run_after) FROM job WHERE status = 'queued'),
           (SELECT min(lease_until) FROM job WHERE status = 'running')
         ) AS at`
      ).pipe(Effect.map((r) => Option.fromNullishOr(r[0]?.at)))

      const get = Effect.fn("JobQueue.get")(function*(id: JobId) {
        const found = yield* rows(sql.unsafe(`SELECT ${columns} FROM job WHERE id = $1`, [id]))
        return Option.fromNullishOr(found[0])
      })

      return JobQueue.of({ enqueue, claim, complete, retryOrBury, sweepExpired, nextDueAt, get })
    })
  )
}
