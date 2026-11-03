import { assert, describe, layer } from "@effect/vitest"
import { Duration, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { JobQueue } from "../src/queue/JobQueue.ts"
import { TestDb, truncateJobs } from "./support/TestDb.ts"

const lease = Duration.seconds(30)
const claimOpts = { lease, maxInFlightGlobal: 100 }

// Real clock throughout: lease expiry and run_after are judged by Postgres now().
layer(JobQueue.layer.pipe(Layer.provideMerge(TestDb)), { excludeTestServices: true })("JobQueue (real Postgres)", (it) => {
  describe("enqueue", () => {
    it.effect("dedupes on dedupe_key (P23)", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        const a = yield* q.enqueue({ kind: "echo", payload: {}, dedupeKey: "grade:s1" })
        const b = yield* q.enqueue({ kind: "echo", payload: {}, dedupeKey: "grade:s1" })
        assert.isTrue(a.created)
        assert.isFalse(b.created)
        assert.strictEqual(a.id, b.id)
      }))
  })

  describe("claim", () => {
    it.effect("claims each job exactly once under concurrent claimers (SKIP LOCKED)", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        for (let i = 0; i < 40; i++) yield* q.enqueue({ kind: "echo", payload: { i } })
        // 10 claimers race until the queue is empty.
        const claimer = Effect.gen(function*() {
          const mine: Array<string> = []
          while (true) {
            const job = yield* q.claim(claimOpts)
            if (Option.isNone(job)) return mine
            mine.push(job.value.id)
          }
        })
        const results = yield* Effect.all(Array.from({ length: 10 }, () => claimer), { concurrency: "unbounded" })
        const all = results.flat()
        assert.strictEqual(all.length, 40)
        assert.strictEqual(new Set(all).size, 40)
      }))

    it.effect("respects the global in-flight cap across workers (D-12)", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        for (let i = 0; i < 5; i++) yield* q.enqueue({ kind: "echo", payload: {} })
        const opts = { lease, maxInFlightGlobal: 2 }
        assert.isTrue(Option.isSome(yield* q.claim(opts)))
        assert.isTrue(Option.isSome(yield* q.claim(opts)))
        assert.isTrue(Option.isNone(yield* q.claim(opts)))
      }))

    it.effect("does not claim jobs scheduled in the future", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        const sql = yield* SqlClient.SqlClient
        const { id } = yield* q.enqueue({ kind: "echo", payload: {} })
        yield* sql`UPDATE job SET run_after = now() + interval '1 minute' WHERE id = ${id}`
        assert.isTrue(Option.isNone(yield* q.claim(claimOpts)))
        const next = yield* q.nextDueAt
        assert.isTrue(Option.isSome(next) && next.value.getTime() > Date.now())
      }))
  })

  describe("complete / retry fencing", () => {
    it.effect("a stale holder cannot complete a job re-claimed by someone else", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        yield* q.enqueue({ kind: "echo", payload: {} })
        const first = Option.getOrThrow(yield* q.claim({ lease: Duration.millis(10), maxInFlightGlobal: 100 }))
        yield* Effect.sleep(Duration.millis(50))
        assert.strictEqual(yield* q.sweepExpired, 1)
        const second = Option.getOrThrow(yield* q.claim(claimOpts))
        assert.strictEqual(second.attempts, 2)
        assert.isFalse(yield* q.complete(first))
        assert.isTrue(yield* q.complete(second))
        const row = Option.getOrThrow(yield* q.get(second.id))
        assert.strictEqual(row.status, "done")
      }))

    it.effect("retries with a delay, then buries after max attempts", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        yield* q.enqueue({ kind: "echo", payload: {}, maxAttempts: 2 })
        const a1 = Option.getOrThrow(yield* q.claim(claimOpts))
        assert.strictEqual(yield* q.retryOrBury(a1, "boom 1", Duration.zero), "retrying")
        const a2 = Option.getOrThrow(yield* q.claim(claimOpts))
        assert.strictEqual(yield* q.retryOrBury(a2, "boom 2", Duration.zero), "dead")
        const row = Option.getOrThrow(yield* q.get(a2.id))
        assert.strictEqual(row.status, "dead")
        assert.strictEqual(row.lastError, "boom 2")
        assert.isTrue(Option.isNone(yield* q.claim(claimOpts)))
      }))
  })

  describe("sweepExpired", () => {
    it.effect("re-queues jobs whose worker died, and buries them once out of attempts", () =>
      Effect.gen(function*() {
        yield* truncateJobs
        const q = yield* JobQueue
        yield* q.enqueue({ kind: "echo", payload: {}, maxAttempts: 1 })
        yield* q.enqueue({ kind: "echo", payload: {}, maxAttempts: 3 })
        const short = { lease: Duration.millis(10), maxInFlightGlobal: 100 }
        yield* q.claim(short)
        yield* q.claim(short)
        yield* Effect.sleep(Duration.millis(50))
        assert.strictEqual(yield* q.sweepExpired, 2)
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string; n: number }>`
          SELECT status, count(*)::int AS n FROM job GROUP BY status ORDER BY status`
        assert.deepStrictEqual(rows.map((r) => [r.status, r.n]), [["dead", 1], ["queued", 1]])
      }))
  })
})
