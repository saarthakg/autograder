import { Context, Duration, Effect, Layer, Option, Queue } from "effect"

/**
 * In-process doorbell for the worker loop. Rings coalesce: a burst of
 * 100 enqueues wakes the loop once, and it then drains everything due.
 */
export class WakeSignal extends Context.Service<WakeSignal, {
  readonly ring: Effect.Effect<void>
  /** Resolves on a ring or after `timeout`, whichever is first. */
  readonly waitFor: (timeout: Duration.Duration) => Effect.Effect<"rung" | "timeout">
}>()("autograder/WakeSignal") {
  static readonly layer = Layer.effect(
    WakeSignal,
    Effect.gen(function*() {
      const bell = yield* Queue.dropping<void>(1)
      return WakeSignal.of({
        ring: Queue.offer(bell, undefined).pipe(Effect.asVoid),
        waitFor: (timeout) =>
          Queue.take(bell).pipe(
            Effect.timeoutOption(timeout),
            Effect.map((o) => (Option.isSome(o) ? "rung" : "timeout"))
          )
      })
    })
  )
}
