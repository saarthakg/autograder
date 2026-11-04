import { CurrentStudent, CurrentTeacher, StudentAuth, TeacherAuth, Unauthorized } from "@autograder/domain"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { sha256 } from "../product/Codes.ts"
import { Students } from "../product/Students.ts"

/** The teacher's capability secret, sent as a bearer token, matched by hash. */
export const TeacherAuthLive = Layer.effect(
  TeacherAuth,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return TeacherAuth.of({
      bearer: Effect.fn(function*(httpEffect, { credential }) {
        const rows = yield* sql<{ id: string }>`SELECT id FROM teacher WHERE secret_hash = ${sha256(Redacted.value(credential))}`.pipe(Effect.orDie)
        const teacher = rows[0]
        if (teacher === undefined) return yield* new Unauthorized({ message: "unknown teacher link" })
        return yield* Effect.provideService(httpEffect, CurrentTeacher, { id: teacher.id })
      })
    })
  })
)

export const StudentAuthLive = Layer.effect(
  StudentAuth,
  Effect.gen(function*() {
    const students = yield* Students
    return StudentAuth.of({
      bearer: Effect.fn(function*(httpEffect, { credential }) {
        const student = yield* students.authenticate(Redacted.value(credential)).pipe(Effect.orDie)
        if (student === undefined) return yield* new Unauthorized({ message: "please rejoin with your codes" })
        return yield* Effect.provideService(httpEffect, CurrentStudent, student)
      })
    })
  })
)
