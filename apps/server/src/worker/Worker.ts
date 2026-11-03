import { Cause, Duration, Effect, FiberSet, Layer, Option, Schedule, Semaphore } from "effect"
import { AppConfig } from "../AppConfig.ts"
import { Instance } from "../Instance.ts"
import { retryDelay } from "../queue/Backoff.ts"
import { JobQueue, type JobRow } from "../queue/JobQueue.ts"
import { JobHandlers } from "./JobHandlers.ts"
import { WakeSignal } from "./WakeSignal.ts"

/** When nothing is claimable but work is due (e.g. the global cap is full), don't spin. */
const MIN_IDLE = Duration.millis(250)
/** Back off this long after a database error in the loop itself. */
const DB_ERROR_PAUSE = Duration.seconds(5)

/**
 * The grading worker (D-12, D-27). One loop claims jobs while a local permit
 * is free; each job runs in its own fiber. When idle it sleeps until the
 * earliest of: a wake from the API, the next due retry or lease expiry, or
 * `idlePoll`, so an idle system issues ~no queries and Neon can suspend (D-20 A5).
 *
 * Shutdown (SIGTERM, ~10 s on Cloud Run): stop claiming, give in-flight jobs
 * `shutdownGrace`, then interrupt. Interrupted jobs keep their lease, which
 * expires and is swept by the next worker, so nothing is lost (D-20 A3).
 */
export const WorkerLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* AppConfig
    const queue = yield* JobQueue
    const handlers = yield* JobHandlers
    const wake = yield* WakeSignal
    const instance = yield* Instance
    const permits = yield* Semaphore.make(config.worker.concurrency)
    const inFlight = yield* FiberSet.make<void, never>()

    // Registered after the FiberSet, so it runs *before* the set interrupts its fibers.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function*() {
        const running = yield* FiberSet.size(inFlight)
        yield* Effect.logInfo(`worker stopping; waiting up to ${Duration.format(config.worker.shutdownGrace)} for ${running} job(s)`)
        yield* FiberSet.awaitEmpty(inFlight).pipe(Effect.timeoutOption(config.worker.shutdownGrace))
      })
    )

    const runJob = (job: JobRow) =>
      Effect.gen(function*() {
        const handler = handlers.get(job.kind)
        if (handler === undefined) {
          yield* queue.retryOrBury(job, `no handler for kind "${job.kind}"`, Duration.zero, { permanent: true })
          return
        }
        const result = yield* Effect.exit(handler(job))
        if (result._tag === "Success") {
          const completed = yield* queue.complete(job)
          if (!completed) yield* Effect.logWarning("job finished after its lease was lost; result discarded")
          return
        }
        const failure = Cause.findErrorOption(result.cause)
        const message = Option.match(failure, { onNone: () => Cause.pretty(result.cause), onSome: (e) => e.message })
        const permanent = Option.exists(failure, (e) => e.permanent === true)
        const delay = permanent
          ? Duration.zero
          : retryDelay(job.attempts, {
            random: Math.random(),
            ...Option.match(failure, { onNone: () => ({}), onSome: (e) => (e.retryAfter ? { retryAfter: e.retryAfter } : {}) })
          })
        const outcome = yield* queue.retryOrBury(job, message, delay, { permanent })
        yield* Effect.logWarning(`job failed: ${message}`).pipe(Effect.annotateLogs({ outcome, attempt: job.attempts }))
      }).pipe(
        Effect.annotateLogs({ jobId: job.id, kind: job.kind }),
        // A DB error while recording the outcome leaves the lease to expire; the sweeper retries it.
        // catch/catchDefect leave interruption (shutdown) untouched.
        Effect.catch((error) => Effect.logError("job bookkeeping failed; lease will expire", error)),
        Effect.catchDefect((defect) => Effect.logError("job crashed; lease will expire", defect)),
        Effect.ensuring(Semaphore.release(permits, 1))
      )

    const idleWait = Effect.gen(function*() {
      yield* queue.sweepExpired
      const next = yield* queue.nextDueAt
      const untilNext = Option.match(next, {
        onNone: () => config.worker.idlePoll,
        onSome: (at) => Duration.millis(Math.max(0, at.getTime() - Date.now()))
      })
      const wait = Duration.max(MIN_IDLE, Duration.min(untilNext, config.worker.idlePoll))
      yield* wake.waitFor(wait)
    })

    const loop = Effect.gen(function*() {
      yield* Semaphore.take(permits, 1)
      const claimed = yield* queue.claim({
        lease: config.worker.lease,
        maxInFlightGlobal: config.worker.maxInFlightGlobal
      }).pipe(Effect.onError(() => Semaphore.release(permits, 1)))
      if (Option.isSome(claimed)) {
        yield* FiberSet.run(inFlight, runJob(claimed.value))
        return
      }
      yield* Semaphore.release(permits, 1)
      yield* idleWait
    }).pipe(
      // Database hiccups (e.g. Neon waking up) pause the loop instead of killing it.
      Effect.catch((error) =>
        Effect.logError("worker loop error; pausing", error).pipe(Effect.andThen(Effect.sleep(DB_ERROR_PAUSE)))
      ),
      Effect.forever
    )

    // Startup recovery: jobs left mid-flight by a previous instance.
    const recovered = yield* queue.sweepExpired.pipe(Effect.orElseSucceed(() => 0))
    yield* Effect.logInfo(`worker started (concurrency ${config.worker.concurrency}); recovered ${recovered} expired lease(s)`)
    yield* Effect.forkScoped(loop)

    // Proof of life without traffic: the instance keeps CPU and the loop keeps running (D-20 A2).
    yield* Effect.forkScoped(
      Effect.suspend(() =>
        Effect.logInfo("worker heartbeat").pipe(
          Effect.annotateLogs({ instanceId: instance.id, uptimeSec: Math.round((Date.now() - instance.startedAt) / 1000) })
        )
      ).pipe(Effect.repeat(Schedule.spaced(Duration.minutes(5))))
    )
  })
)
