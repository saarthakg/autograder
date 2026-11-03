import { Context, Duration, Effect, Layer, Schema } from "effect"
import type { JobRow } from "../queue/JobQueue.ts"

/**
 * A handler's expected failure. `retryAfter` carries a provider's Retry-After
 * (P25); `permanent` skips retries for errors that can't succeed later.
 */
export class JobFailure extends Schema.TaggedError<JobFailure>()("JobFailure", {
  message: Schema.String,
  retryAfter: Schema.optional(Schema.Duration),
  permanent: Schema.optional(Schema.Boolean)
}) {}

export type JobHandler = (job: JobRow) => Effect.Effect<void, JobFailure>

/** Registry of job kinds the worker knows how to run. Grading joins in Phase 2. */
export class JobHandlers extends Context.Service<JobHandlers, ReadonlyMap<string, JobHandler>>()(
  "autograder/JobHandlers"
) {
  static readonly layer = Layer.succeed(
    JobHandlers,
    new Map<string, JobHandler>([
      // Phase 1 smoke job: proves API -> queue -> woken worker -> done, deployed.
      ["echo", (job) => Effect.logInfo("echo job ran").pipe(Effect.annotateLogs({ jobId: job.id }), Effect.delay(Duration.millis(20)))]
    ])
  )
}
