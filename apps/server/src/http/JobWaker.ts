import { Context, Duration, Effect, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { AppConfig } from "../AppConfig.ts"
import { WakeSignal } from "../worker/WakeSignal.ts"

/**
 * Tells the worker there's new work (D-27). Fire-and-forget: the job is already
 * committed, so a lost wake only delays pickup until the worker's next timed check.
 * In ROLE=all the worker lives in this process and we ring it directly.
 */
export class JobWaker extends Context.Service<JobWaker, { readonly wake: Effect.Effect<void> }>()(
  "autograder/JobWaker"
) {
  static readonly layer = Layer.effect(
    JobWaker,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const signal = yield* WakeSignal
      if (Option.isNone(config.workerWakeUrl)) {
        if (config.role === "api") {
          // P20: an API without a worker to wake is a deployment bug, not a mode.
          return yield* Effect.die(new Error("ROLE=api requires WORKER_WAKE_URL"))
        }
        return JobWaker.of({ wake: signal.ring })
      }
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const request = HttpClientRequest.post(`${config.workerWakeUrl.value}/api/internal/wake`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(config.internalToken))
      )
      const send = client.execute(request).pipe(
        Effect.timeout(Duration.seconds(3)),
        Effect.catch((error) => Effect.logWarning("worker wake failed; job will be picked up on the next timed check", error)),
        Effect.asVoid
      )
      return JobWaker.of({ wake: Effect.forkDetach(send).pipe(Effect.asVoid) })
    })
  )
}
