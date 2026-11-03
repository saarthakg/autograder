import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** Shared bearer token for operator and service-to-service endpoints. */
export class InternalAuth extends HttpApiMiddleware.Service<InternalAuth>()("autograder/InternalAuth", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized
}) {}

export const JobId = Schema.String.pipe(Schema.brand("JobId"))
export type JobId = typeof JobId.Type

export const JobStatus = Schema.Literals(["queued", "running", "done", "dead"])
export type JobStatus = typeof JobStatus.Type

export class JobView extends Schema.Class<JobView>("JobView")({
  id: JobId,
  kind: Schema.String,
  status: JobStatus,
  attempts: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString,
  claimedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastError: Schema.NullOr(Schema.String)
}) {}

export class JobNotFound extends Schema.TaggedError<JobNotFound>()(
  "JobNotFound",
  { id: JobId },
  { httpApiStatus: 404 }
) {}

export class InternalApi extends HttpApiGroup.make("internal")
  .add(
    // Phase 1 smoke path: proves API -> queue -> woken worker end to end.
    HttpApiEndpoint.post("enqueueEcho", "/jobs/echo", {
      payload: Schema.Struct({ runId: Schema.optional(Schema.String) }),
      success: JobView
    }),
    HttpApiEndpoint.get("getJob", "/jobs/:id", {
      params: { id: JobId },
      success: JobView,
      error: JobNotFound
    }),
    // Sent by the API after it commits a job (D-27). A lost wake only delays work.
    HttpApiEndpoint.post("wake", "/wake", { success: HttpApiSchema.NoContent })
  )
  .middleware(InternalAuth)
  .prefix("/internal")
{}
