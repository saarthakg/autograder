import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Exit, Layer, Option, Scope } from "effect"
import { Instance } from "../src/Instance.ts"
import { JobQueue } from "../src/queue/JobQueue.ts"
import { JobFailure, type JobHandler, JobHandlers } from "../src/worker/JobHandlers.ts"
import { WakeSignal } from "../src/worker/WakeSignal.ts"
import { WorkerLive } from "../src/worker/Worker.ts"
import { testConfig } from "./support/TestConfig.ts"
import { TestDb, truncateJobs } from "./support/TestDb.ts"

const handlersLayer = (entries: Record<string, JobHandler>) => Layer.succeed(JobHandlers, new Map(Object.entries(entries)))

/** Polls the job's status until it matches or the deadline passes. */
const waitForStatus = (id: string, status: string, within: Duration.Duration) =>
  Effect.gen(function*() {
    const q = yield* JobQueue
    const deadline = Date.now() + Duration.toMillis(within)
    while (Date.now() < deadline) {
      const job = yield* q.get(id as never)
      if (Option.isSome(job) && job.value.status === status) return job.value
      yield* Effect.sleep(Duration.millis(25))
    }
    return yield* Effect.die(new Error(`job ${id} did not reach ${status} within ${Duration.format(within)}`))
  })

/** Base services shared by a test and the worker it starts. */
const base = Layer.mergeAll(JobQueue.layer, WakeSignal.layer, Instance.layer).pipe(Layer.provideMerge(TestDb))

/** Starts the worker in a child scope we can close to simulate SIGTERM. */
const startWorker = (handlers: Record<string, JobHandler>, worker?: Parameters<typeof testConfig>[0]) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const ctx = yield* Effect.context<JobQueue | WakeSignal | Instance>()
    yield* Layer.buildWithScope(
      WorkerLive.pipe(Layer.provide([testConfig(worker), handlersLayer(handlers), Layer.succeedContext(ctx)])),
      scope
    )
    return scope
  })

describe("Worker (real Postgres)", () => {
  it.live("a wake makes an idle worker pick up a new job immediately (D-27)", () =>
    Effect.gen(function*() {
      yield* truncateJobs
      const q = yield* JobQueue
      const wake = yield* WakeSignal
      yield* startWorker({ echo: () => Effect.void })
      // Let the worker go idle (idlePoll is 60 min, so only a wake can rouse it).
      yield* Effect.sleep(Duration.millis(300))
      const { id } = yield* q.enqueue({ kind: "echo", payload: {} })
      const started = Date.now()
      yield* wake.ring
      yield* waitForStatus(id, "done", Duration.seconds(2))
      assert.isBelow(Date.now() - started, 1_000)
    }).pipe(Effect.scoped, Effect.provide(base)))

  it.live("retries a failing job with backoff and buries it after max attempts", () =>
    Effect.gen(function*() {
      yield* truncateJobs
      const q = yield* JobQueue
      const wake = yield* WakeSignal
      let calls = 0
      yield* startWorker({
        flaky: () => Effect.suspend(() => {
          calls++
          // retryAfter 0 + random backoff could be up to 2 s; permanent on the 2nd call keeps the test fast.
          return Effect.fail(new JobFailure({ message: `fail ${calls}`, permanent: calls >= 2 }))
        })
      })
      const { id } = yield* q.enqueue({ kind: "flaky", payload: {}, maxAttempts: 5 })
      yield* wake.ring
      const dead = yield* waitForStatus(id, "dead", Duration.seconds(5))
      assert.strictEqual(dead.lastError, "fail 2")
      assert.strictEqual(dead.attempts, 2)
    }).pipe(Effect.scoped, Effect.provide(base)))

  it.live("shutdown mid-job leaves the lease to expire, and the next worker finishes it (D-20 A3)", () =>
    Effect.gen(function*() {
      yield* truncateJobs
      const q = yield* JobQueue
      const wake = yield* WakeSignal
      const shortLease = { lease: Duration.millis(500), shutdownGrace: Duration.millis(100) }
      // First worker: the job hangs far past the shutdown grace.
      const first = yield* startWorker({ echo: () => Effect.never }, shortLease)
      const { id } = yield* q.enqueue({ kind: "echo", payload: {} })
      yield* wake.ring
      yield* waitForStatus(id, "running", Duration.seconds(2))
      yield* Scope.close(first, Exit.void)
      const stuck = Option.getOrThrow(yield* q.get(id as never))
      assert.strictEqual(stuck.status, "running")
      // Second worker recovers it once the lease expires.
      yield* startWorker({ echo: () => Effect.void }, shortLease)
      const done = yield* waitForStatus(id, "done", Duration.seconds(4))
      assert.strictEqual(done.attempts, 2)
    }).pipe(Effect.scoped, Effect.provide(base)))
})
