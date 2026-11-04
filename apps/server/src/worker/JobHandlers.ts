import { Context, Duration, Effect, Schema } from "effect"
import type { JobRow } from "../queue/JobQueue.ts"

/**
 * A handler's expected failure. `retryAfter` carries a provider's Retry-After;
 * `permanent` skips retries for errors that can't succeed later.
 */
export class JobFailure extends Schema.TaggedError<JobFailure>()("JobFailure", {
  message: Schema.String,
  retryAfter: Schema.optional(Schema.Duration),
  permanent: Schema.optional(Schema.Boolean)
}) {}

export interface JobHandler {
  readonly run: (job: JobRow) => Effect.Effect<void, JobFailure>
  /** Runs once a job is buried (out of attempts, or swept after its last lease), e.g. to mark needs_review. */
  readonly onDead?: ((job: JobRow, lastError: string) => Effect.Effect<void>) | undefined
}

/** Registry of job kinds the worker knows how to run. */
export class JobHandlers extends Context.Service<JobHandlers, ReadonlyMap<string, JobHandler>>()(
  "autograder/JobHandlers"
) {}

/** Smoke job: proves API -> queue -> worker -> done on a deployed instance. */
export const echoHandler: JobHandler = {
  run: (job) => Effect.logInfo("echo job ran").pipe(Effect.annotateLogs({ jobId: job.id }), Effect.delay(Duration.millis(20)))
}
