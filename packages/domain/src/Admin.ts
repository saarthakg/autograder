import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { Confidence, Rubric } from "./Grading.ts"
import { Strokes } from "./Strokes.ts"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** Operator bearer token (ADMIN_TOKEN): ops and load-test endpoints. */
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

// --- Submissions ------------------------------------------------------------

export class InvalidSubmission extends Schema.TaggedError<InvalidSubmission>()(
  "InvalidSubmission",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

/** One attempt per problem. */
export class AlreadySubmitted extends Schema.TaggedError<AlreadySubmitted>()(
  "AlreadySubmitted",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

export const SubmissionStatus = Schema.Literals(["queued", "grading", "graded", "needs_review"])
export const ReviewReason = Schema.Literals(["illegible", "invalid_output", "grading_failed"])

export class SubmitRequest extends Schema.Class<SubmitRequest>("SubmitRequest")({
  studentId: Schema.String,
  problemId: Schema.String,
  /** Client-generated per drawing; a retried request with the same key is a no-op. */
  idempotencyKey: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(100)),
  strokes: Strokes,
  imagePng: Schema.Uint8ArrayFromBase64
}) {}

export class SubmissionAccepted extends Schema.Class<SubmissionAccepted>("SubmissionAccepted")({
  id: Schema.String,
  status: SubmissionStatus,
  created: Schema.Boolean
}) {}

export class GradeView extends Schema.Class<GradeView>("GradeView")({
  totalPoints: Schema.Int,
  maxPoints: Schema.Int,
  legible: Schema.Boolean,
  confidence: Confidence,
  transcription: Schema.String,
  verdicts: Schema.Array(Schema.Struct({ id: Schema.String, met: Schema.Boolean, evidence: Schema.String })),
  model: Schema.String
}) {}

export class SubmissionView extends Schema.Class<SubmissionView>("SubmissionView")({
  id: Schema.String,
  status: SubmissionStatus,
  reviewReason: Schema.NullOr(ReviewReason),
  acceptedAt: Schema.DateTimeUtcFromString,
  gradedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  grade: Schema.NullOr(GradeView)
}) {}

export class SubmissionNotFound extends Schema.TaggedError<SubmissionNotFound>()(
  "SubmissionNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 }
) {}

// --- Demo class, rubrics, fixtures ------------------------------------------

export class DemoClass extends Schema.Class<DemoClass>("DemoClass")({
  assignmentId: Schema.String,
  studentId: Schema.String,
  problems: Schema.Array(Schema.Struct({ id: Schema.String, key: Schema.String, position: Schema.Int }))
}) {}

export class RubricGenerationFailed extends Schema.TaggedError<RubricGenerationFailed>()(
  "RubricGenerationFailed",
  { message: Schema.String },
  { httpApiStatus: 502 }
) {}

/** The drawer's page showed instructions that no longer match the case (stale build). */
export class StaleFixture extends Schema.TaggedError<StaleFixture>()(
  "StaleFixture",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

export class FixturesDisabled extends Schema.TaggedError<FixturesDisabled>()(
  "FixturesDisabled",
  { message: Schema.String },
  { httpApiStatus: 404 }
) {}

export class AdminApi extends HttpApiGroup.make("admin")
  .add(
    // Smoke path: proves API -> queue -> in-process worker end to end on a deployed instance.
    HttpApiEndpoint.post("enqueueEcho", "/jobs/echo", {
      payload: Schema.Struct({ runId: Schema.optional(Schema.String) }),
      success: JobView
    }),
    HttpApiEndpoint.get("getJob", "/jobs/:id", {
      params: { id: JobId },
      success: JobView,
      error: JobNotFound
    }),
    // Drive real grading without the UI: a demo class, then submissions against it.
    HttpApiEndpoint.post("createDemoClass", "/demo-class", { success: DemoClass }),
    HttpApiEndpoint.post("submit", "/submissions", {
      payload: SubmitRequest,
      success: SubmissionAccepted,
      error: [InvalidSubmission, AlreadySubmitted]
    }),
    HttpApiEndpoint.get("getSubmission", "/submissions/:id", {
      params: { id: Schema.String },
      success: SubmissionView,
      error: SubmissionNotFound
    }),
    HttpApiEndpoint.post("generateRubric", "/rubrics/generate", {
      payload: Schema.Struct({
        prompt: Schema.String.check(Schema.isNonEmpty()),
        answerKey: Schema.NullOr(Schema.String),
        maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }))
      }),
      success: Rubric,
      error: RubricGenerationFailed
    }),
    // Dev-only fixture capture: writes strokes + PNG to FIXTURE_DIR.
    HttpApiEndpoint.post("saveFixture", "/fixtures", {
      payload: Schema.Struct({
        caseKey: Schema.String,
        instructionHash: Schema.String,
        strokes: Strokes,
        imagePng: Schema.Uint8ArrayFromBase64
      }),
      success: Schema.Struct({ path: Schema.String }),
      error: [FixturesDisabled, StaleFixture]
    })
  )
  .middleware(AdminAuth)
  .prefix("/admin")
{}
