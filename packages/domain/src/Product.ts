import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { AlreadySubmitted, InvalidSubmission, SubmissionAccepted, Unauthorized } from "./Admin.ts"
import { Confidence, Rubric } from "./Grading.ts"
import { Strokes } from "./Strokes.ts"

/**
 * Phase 3 product API: teacher workspaces and student flows (P1, P2, D-04).
 * Identity is a capability: the teacher's secret link, the student's token.
 */

// --- Errors -------------------------------------------------------------------

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { message: Schema.String }, { httpApiStatus: 404 }) {}

export class InvalidRubric extends Schema.TaggedError<InvalidRubric>()(
  "InvalidRubric",
  { problems: Schema.Array(Schema.String) },
  { httpApiStatus: 400 }
) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

/** The assignment isn't accepting work (draft or closed). */
export class AssignmentNotOpen extends Schema.TaggedError<AssignmentNotOpen>()(
  "AssignmentNotOpen",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

// --- Auth -----------------------------------------------------------------------

export class CurrentTeacher extends Context.Service<CurrentTeacher, { readonly id: string }>()("autograder/CurrentTeacher") {}
export class CurrentStudent extends Context.Service<CurrentStudent, { readonly id: string; readonly assignmentId: string }>()(
  "autograder/CurrentStudent"
) {}

export class TeacherAuth extends HttpApiMiddleware.Service<TeacherAuth, { provides: CurrentTeacher; requires: never }>()(
  "autograder/TeacherAuth",
  { requiredForClient: true, security: { bearer: HttpApiSecurity.bearer }, error: Unauthorized }
) {}

export class StudentAuth extends HttpApiMiddleware.Service<StudentAuth, { provides: CurrentStudent; requires: never }>()(
  "autograder/StudentAuth",
  { requiredForClient: true, security: { bearer: HttpApiSecurity.bearer }, error: Unauthorized }
) {}

// --- Shared shapes ----------------------------------------------------------------

export const AssignmentStatus = Schema.Literals(["draft", "open", "closed"])
export type AssignmentStatus = typeof AssignmentStatus.Type

export class ProblemInput extends Schema.Class<ProblemInput>("ProblemInput")({
  prompt: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1000)),
  answerKey: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }))
}) {}

export const RubricSource = Schema.Literals(["generated", "edited", "sample", "template"])

export class ProblemView extends Schema.Class<ProblemView>("ProblemView")({
  id: Schema.String,
  position: Schema.Int,
  prompt: Schema.String,
  answerKey: Schema.NullOr(Schema.String),
  maxPoints: Schema.Int,
  rubric: Rubric,
  rubricVersion: Schema.Int,
  rubricSource: RubricSource
}) {}

// --- Teacher ------------------------------------------------------------------------

export class Workspace extends Schema.Class<Workspace>("Workspace")({
  teacherId: Schema.String,
  /** Shown once; the teacher link is /t#k=<secret>. Only its hash is stored (D-04). */
  secret: Schema.String
}) {}

export class AssignmentSummary extends Schema.Class<AssignmentSummary>("AssignmentSummary")({
  id: Schema.String,
  title: Schema.String,
  status: AssignmentStatus,
  classCode: Schema.NullOr(Schema.String),
  problemCount: Schema.Int,
  studentCount: Schema.Int,
  gradedCount: Schema.Int,
  reviewCount: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString
}) {}

export class AssignmentDetail extends Schema.Class<AssignmentDetail>("AssignmentDetail")({
  id: Schema.String,
  title: Schema.String,
  status: AssignmentStatus,
  classCode: Schema.NullOr(Schema.String),
  shareSlug: Schema.NullOr(Schema.String),
  showCriteria: Schema.Boolean,
  problems: Schema.Array(ProblemView),
  /** Problems whose rubric couldn't be drafted; the teacher starts from a template (D-08). */
  rubricFallbacks: Schema.Array(Schema.String)
}) {}

export const CellStatus = Schema.Literals(["not_started", "grading", "graded", "needs_review"])

export class ReportCell extends Schema.Class<ReportCell>("ReportCell")({
  problemId: Schema.String,
  submissionId: Schema.NullOr(Schema.String),
  status: CellStatus,
  score: Schema.NullOr(Schema.Int),
  overridden: Schema.Boolean,
  /** Graded under an earlier rubric version than the current one (D-10). */
  staleRubric: Schema.Boolean
}) {}

export class ReportStudent extends Schema.Class<ReportStudent>("ReportStudent")({
  id: Schema.String,
  displayName: Schema.String,
  rejoinCode: Schema.String,
  cells: Schema.Array(ReportCell),
  total: Schema.Int,
  maxPossible: Schema.Int,
  submitted: Schema.Int
}) {}

export class CriterionStat extends Schema.Class<CriterionStat>("CriterionStat")({
  id: Schema.String,
  label: Schema.String,
  points: Schema.Int,
  judged: Schema.Int,
  missed: Schema.Int
}) {}

export class ProblemStat extends Schema.Class<ProblemStat>("ProblemStat")({
  id: Schema.String,
  position: Schema.Int,
  prompt: Schema.String,
  maxPoints: Schema.Int,
  graded: Schema.Int,
  average: Schema.NullOr(Schema.Finite),
  criteria: Schema.Array(CriterionStat)
}) {}

export const ReviewQueueReason = Schema.Literals([
  "grading_failed",
  "invalid_output",
  "illegible",
  "low_confidence",
  "medium_confidence",
  "stale_rubric"
])
export type ReviewQueueReason = typeof ReviewQueueReason.Type

export class ReviewItem extends Schema.Class<ReviewItem>("ReviewItem")({
  submissionId: Schema.String,
  studentName: Schema.String,
  problemPosition: Schema.Int,
  reason: ReviewQueueReason,
  risk: Schema.Int
}) {}

export class Report extends Schema.Class<Report>("Report")({
  assignmentId: Schema.String,
  title: Schema.String,
  status: AssignmentStatus,
  classCode: Schema.NullOr(Schema.String),
  problems: Schema.Array(ProblemStat),
  students: Schema.Array(ReportStudent),
  reviewQueue: Schema.Array(ReviewItem),
  graded: Schema.Int,
  worthALook: Schema.Int
}) {}

export class CriterionDetail extends Schema.Class<CriterionDetail>("CriterionDetail")({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  points: Schema.Int,
  modelMet: Schema.NullOr(Schema.Boolean),
  evidence: Schema.NullOr(Schema.String),
  override: Schema.NullOr(Schema.Boolean),
  /** override ?? modelMet: what counts (P4). */
  met: Schema.NullOr(Schema.Boolean)
}) {}

export class SubmissionDetail extends Schema.Class<SubmissionDetail>("SubmissionDetail")({
  id: Schema.String,
  studentName: Schema.String,
  problem: ProblemView,
  strokes: Strokes,
  status: CellStatus,
  reviewReason: Schema.NullOr(Schema.String),
  transcription: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Confidence),
  /** The model that actually graded it: the primary or a fallback (D-30). */
  model: Schema.NullOr(Schema.String),
  /** The OpenRouter provider that served that model, when reported. */
  provider: Schema.NullOr(Schema.String),
  criteria: Schema.Array(CriterionDetail),
  /** Null until every criterion has a verdict (model or teacher). */
  score: Schema.NullOr(Schema.Int),
  maxPoints: Schema.Int,
  gradedWithRubricVersion: Schema.NullOr(Schema.Int)
}) {}

export class TemplateView extends Schema.Class<TemplateView>("TemplateView")({
  title: Schema.String,
  problems: Schema.Array(Schema.Struct({ prompt: Schema.String, answerKey: Schema.NullOr(Schema.String), maxPoints: Schema.Int, rubric: Rubric }))
}) {}

const id = { id: Schema.String }

export class TeacherApi extends HttpApiGroup.make("teacher")
  .add(
    HttpApiEndpoint.get("listAssignments", "/assignments", { success: Schema.Array(AssignmentSummary) }),
    HttpApiEndpoint.post("createAssignment", "/assignments", {
      payload: Schema.Struct({
        title: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(120)),
        problems: Schema.Array(ProblemInput).check(Schema.isMinLength(1), Schema.isMaxLength(10))
      }),
      success: AssignmentDetail,
      error: NotFound
    }),
    HttpApiEndpoint.post("createSample", "/assignments/sample", { success: AssignmentDetail, error: NotFound }),
    HttpApiEndpoint.get("getAssignment", "/assignments/:id", { params: id, success: AssignmentDetail, error: NotFound }),
    HttpApiEndpoint.put("saveRubric", "/problems/:id/rubric", {
      params: id,
      payload: Rubric,
      success: ProblemView,
      error: [NotFound, InvalidRubric]
    }),
    HttpApiEndpoint.post("publish", "/assignments/:id/publish", { params: id, success: AssignmentDetail, error: NotFound }),
    HttpApiEndpoint.post("close", "/assignments/:id/close", { params: id, success: AssignmentDetail, error: NotFound }),
    HttpApiEndpoint.put("setShowCriteria", "/assignments/:id/show-criteria", {
      params: id,
      payload: Schema.Struct({ showCriteria: Schema.Boolean }),
      success: AssignmentDetail,
      error: NotFound
    }),
    HttpApiEndpoint.get("report", "/assignments/:id/report", { params: id, success: Report, error: NotFound }),
    HttpApiEndpoint.get("getSubmission", "/submissions/:id", { params: id, success: SubmissionDetail, error: NotFound }),
    HttpApiEndpoint.put("override", "/submissions/:id/criteria/:criterionId", {
      params: { id: Schema.String, criterionId: Schema.String },
      payload: Schema.Struct({ met: Schema.Boolean }),
      success: SubmissionDetail,
      error: [NotFound, InvalidRequest]
    }),
    HttpApiEndpoint.post("share", "/assignments/:id/share", { params: id, success: Schema.Struct({ slug: Schema.String }), error: NotFound }),
    HttpApiEndpoint.post("copyTemplate", "/templates/:slug/copy", { params: { slug: Schema.String }, success: AssignmentDetail, error: NotFound })
  )
  .middleware(TeacherAuth)
  .prefix("/teacher")
{}

/** Unauthenticated entry points: create a workspace, view a shared template, student join/rejoin. */
export class PublicApi extends HttpApiGroup.make("public")
  .add(
    HttpApiEndpoint.post("createWorkspace", "/workspace", { success: Workspace }),
    HttpApiEndpoint.get("getTemplate", "/templates/:slug", { params: { slug: Schema.String }, success: TemplateView, error: NotFound }),
    HttpApiEndpoint.post("join", "/join", {
      payload: Schema.Struct({
        classCode: Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(12)),
        displayName: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(40))
      }),
      success: Schema.Struct({ token: Schema.String, rejoinCode: Schema.String, displayName: Schema.String }),
      error: [NotFound, AssignmentNotOpen, InvalidRequest]
    }),
    HttpApiEndpoint.post("rejoin", "/rejoin", {
      payload: Schema.Struct({ classCode: Schema.String, rejoinCode: Schema.String }),
      success: Schema.Struct({ token: Schema.String, rejoinCode: Schema.String, displayName: Schema.String }),
      error: NotFound
    })
  )
{}

export const StudentSubmissionState = Schema.Literals(["grading", "graded", "teacher_check"])

export class StudentProblem extends Schema.Class<StudentProblem>("StudentProblem")({
  id: Schema.String,
  position: Schema.Int,
  prompt: Schema.String,
  maxPoints: Schema.Int,
  submission: Schema.NullOr(Schema.Struct({
    state: StudentSubmissionState,
    score: Schema.NullOr(Schema.Int),
    /** Labels of met criteria, task-framed (D-01). Empty when the teacher turned this off. */
    metLabels: Schema.Array(Schema.String)
  }))
}) {}

export class StudentHome extends Schema.Class<StudentHome>("StudentHome")({
  assignmentTitle: Schema.String,
  status: AssignmentStatus,
  displayName: Schema.String,
  rejoinCode: Schema.String,
  classCode: Schema.String,
  problems: Schema.Array(StudentProblem)
}) {}

export class StudentApi extends HttpApiGroup.make("student")
  .add(
    HttpApiEndpoint.get("home", "/me", { success: StudentHome }),
    HttpApiEndpoint.post("submit", "/submissions", {
      payload: Schema.Struct({
        problemId: Schema.String,
        idempotencyKey: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(100)),
        strokes: Strokes,
        imagePng: Schema.Uint8ArrayFromBase64
      }),
      success: SubmissionAccepted,
      error: [InvalidSubmission, AlreadySubmitted, AssignmentNotOpen, NotFound]
    })
  )
  .middleware(StudentAuth)
  .prefix("/student")
{}
