import { Api, DatabaseUnavailable, Health, JobNotFound, JobView, Readiness } from "@autograder/domain"
import { DateTime, Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { Instance } from "../Instance.ts"
import { JobQueue, type JobRow } from "../queue/JobQueue.ts"
import { WakeSignal } from "../worker/WakeSignal.ts"
import { JobWaker } from "./JobWaker.ts"

const toView = (job: JobRow) =>
  new JobView({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    createdAt: DateTime.fromDateUnsafe(job.createdAt),
    claimedAt: job.claimedAt ? DateTime.fromDateUnsafe(job.claimedAt) : null,
    finishedAt: job.finishedAt ? DateTime.fromDateUnsafe(job.finishedAt) : null,
    lastError: job.lastError
  })

export const SystemHandlers = HttpApiBuilder.group(
  Api,
  "system",
  Effect.fn(function*(handlers) {
    const config = yield* AppConfig
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    return handlers.handleAll({
      health: () =>
        Effect.sync(() =>
          new Health({
            status: "ok",
            role: config.role,
            version: config.version,
            instanceId: instance.id,
            uptimeSec: Math.round((Date.now() - instance.startedAt) / 1000)
          })
        ),
      ready: () =>
        Effect.gen(function*() {
          const started = Date.now()
          yield* sql`SELECT 1`
          return new Readiness({ db: "ok", dbLatencyMs: Date.now() - started })
        }).pipe(Effect.catch((e) => Effect.fail(new DatabaseUnavailable({ message: e.message }))))
    })
  })
)

export const InternalHandlers = HttpApiBuilder.group(
  Api,
  "internal",
  Effect.fn(function*(handlers) {
    const queue = yield* JobQueue
    const waker = yield* JobWaker
    const signal = yield* WakeSignal
    return handlers.handleAll({
      enqueueEcho: ({ payload }) =>
        Effect.gen(function*() {
          const { id } = yield* queue.enqueue({ kind: "echo", payload: {}, runId: payload.runId })
          yield* waker.wake
          return toView(Option.getOrThrow(yield* queue.get(id)))
        }).pipe(Effect.orDie),
      getJob: ({ params }) =>
        queue.get(params.id).pipe(
          Effect.orDie,
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new JobNotFound({ id: params.id })),
            onSome: (job) => Effect.succeed(toView(job))
          }))
        ),
      wake: () => signal.ring
    })
  })
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, InternalHandlers)
