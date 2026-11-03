import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** Operator bearer token (ADMIN_TOKEN): ops endpoints and, later, load-test runs (D-28). */
export class AdminAuth extends HttpApiMiddleware.Service<AdminAuth>()("autograder/AdminAuth", {
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

export class AdminApi extends HttpApiGroup.make("admin")
  .add(
    // Phase 1 smoke path: proves API -> queue -> in-process worker end to end, deployed.
    HttpApiEndpoint.post("enqueueEcho", "/jobs/echo", {
      payload: Schema.Struct({ runId: Schema.optional(Schema.String) }),
      success: JobView
    }),
    HttpApiEndpoint.get("getJob", "/jobs/:id", {
      params: { id: JobId },
      success: JobView,
      error: JobNotFound
    })
  )
  .middleware(AdminAuth)
  .prefix("/admin")
{}
