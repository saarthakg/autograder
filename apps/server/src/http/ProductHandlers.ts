import { Api, CurrentStudent, CurrentTeacher, SubmissionAccepted, Workspace } from "@autograder/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { newSecret, sha256 } from "../product/Codes.ts"
import { Students } from "../product/Students.ts"
import { Teachers } from "../product/Teachers.ts"
import { sqlDefect } from "./sqlDefect.ts"

export const PublicHandlers = HttpApiBuilder.group(Api, "public", Effect.fn(function*(handlers) {
  const sql = yield* SqlClient.SqlClient
  const teachers = yield* Teachers
  const students = yield* Students
  return handlers.handleAll({
    createWorkspace: () =>
      Effect.gen(function*() {
        const secret = newSecret()
        const [row] = yield* sql<{ id: string }>`INSERT INTO teacher (secret_hash) VALUES (${sha256(secret)}) RETURNING id`
        return new Workspace({ teacherId: row!.id, secret })
      }).pipe(Effect.orDie),
    getTemplate: ({ params }) => sqlDefect(teachers.templateBySlug(params.slug)).pipe(Effect.map((t) => t.view)),
    join: ({ payload }) => sqlDefect(students.join(payload.classCode, payload.displayName)),
    rejoin: ({ payload }) => sqlDefect(students.rejoin(payload.classCode, payload.rejoinCode))
  })
}))

/** Runs a teacher operation as the authenticated teacher. */
const asTeacher = <A, E, R>(f: (teacherId: string) => Effect.Effect<A, E, R>) =>
  sqlDefect(Effect.gen(function*() {
    const teacher = yield* CurrentTeacher
    return yield* f(teacher.id)
  }))

export const TeacherHandlers = HttpApiBuilder.group(Api, "teacher", Effect.fn(function*(handlers) {
  const t = yield* Teachers
  return handlers.handleAll({
    listAssignments: () => asTeacher(t.list),
    createAssignment: ({ payload }) => asTeacher((me) => t.create(me, payload.title, payload.problems)),
    createSample: () => asTeacher(t.createSample),
    getAssignment: ({ params }) => asTeacher((me) => t.detail(me, params.id)),
    saveRubric: ({ params, payload }) => asTeacher((me) => t.saveRubric(me, params.id, payload)),
    publish: ({ params }) => asTeacher((me) => t.publish(me, params.id)),
    close: ({ params }) => asTeacher((me) => t.close(me, params.id)),
    setStudentView: ({ params, payload }) => asTeacher((me) => t.setStudentView(me, params.id, payload.studentView)),
    report: ({ params }) => asTeacher((me) => t.report(me, params.id)),
    getSubmission: ({ params }) => asTeacher((me) => t.submissionDetail(me, params.id)),
    override: ({ params, payload }) => asTeacher((me) => t.override(me, params.id, params.criterionId, payload.met)),
    share: ({ params }) => asTeacher((me) => t.share(me, params.id)),
    copyTemplate: ({ params }) => asTeacher((me) => t.copyTemplate(me, params.slug))
  })
}))

export const StudentHandlers = HttpApiBuilder.group(Api, "student", Effect.fn(function*(handlers) {
  const students = yield* Students
  return handlers.handleAll({
    home: () => sqlDefect(Effect.gen(function*() {
      const me = yield* CurrentStudent
      return yield* students.home(me.id)
    })),
    submit: ({ payload }) => sqlDefect(Effect.gen(function*() {
      const me = yield* CurrentStudent
      const r = yield* students.submit(me.id, me.assignmentId, payload)
      return new SubmissionAccepted({ id: r.id, status: r.status as SubmissionAccepted["status"], created: r.created })
    }))
  })
}))

export const ProductHandlers = Layer.mergeAll(PublicHandlers, TeacherHandlers, StudentHandlers)
