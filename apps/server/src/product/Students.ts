import { AssignmentNotOpen, InvalidRequest, NameTaken, NotFound, Rubric, StudentHome, StudentProblem, type StudentView, Strokes } from "@autograder/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { Submissions } from "../grading/Submissions.ts"
import { newSecret, normaliseCode, sha256, shortCode } from "./Codes.ts"
import { effective, type StoredVerdict, studentState, type SubmissionStatus } from "./Scoring.ts"

const decodeRubric = Schema.decodeUnknownSync(Rubric)
const decodeStrokes = Schema.decodeUnknownSync(Strokes)

/**
 * Student flows: join with a class code and a name, rejoin from any
 * device with a rejoin code, submit without waiting, see scores arrive.
 * Display names never reach the model: grading only sees the image.
 */
export class Students extends Context.Service<Students, Effect.Success<typeof make>>()("autograder/Students") {
  static readonly layer = Layer.effect(Students, Effect.suspend(() => make))
}

const make = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const submissions = yield* Submissions

  const issueToken = (studentId: string) =>
    Effect.gen(function*() {
      const token = newSecret()
      yield* sql`UPDATE student SET token_hash = ${sha256(token)} WHERE id = ${studentId}`
      return token
    })

  const join = Effect.fn("Students.join")(function*(classCode: string, displayName: string) {
    const name = displayName.trim().replace(/\s+/g, " ")
    if (name.length === 0) return yield* new InvalidRequest({ message: "enter your name" })
    const rows = yield* sql<{ id: string; status: string }>`SELECT id, status FROM assignment WHERE class_code = ${normaliseCode(classCode)}`
    const a = rows[0]
    if (a === undefined) return yield* new NotFound({ message: "no class with that code" })
    if (a.status !== "open") return yield* new AssignmentNotOpen({ message: "this assignment isn't open right now" })
    // Two identical names make indistinguishable report rows, and a student who lost
    // their device should rejoin, not become a second copy of themselves.
    const taken = yield* sql<{ displayName: string }>`
      SELECT display_name AS "displayName" FROM student WHERE assignment_id = ${a.id} AND lower(display_name) = lower(${name}) LIMIT 1`
    if (taken[0] !== undefined) return yield* new NameTaken({ message: "someone with that name already joined", displayName: taken[0].displayName })
    const token = newSecret()
    // Rejoin codes are unique per assignment; retry the rare collision.
    const student = yield* sql<{ id: string; rejoinCode: string }>`
      INSERT INTO student (assignment_id, display_name, rejoin_code, token_hash)
      VALUES (${a.id}, ${name}, ${shortCode(5)}, ${sha256(token)}) RETURNING id, rejoin_code AS "rejoinCode"`.pipe(
      Effect.retry({ times: 3 }),
      Effect.map((r) => r[0]!)
    )
    return { token, rejoinCode: student.rejoinCode, displayName: name }
  })

  /** A new device gets a fresh token for the same student; the old token stops working. */
  const rejoin = Effect.fn("Students.rejoin")(function*(classCode: string, rejoinCode: string) {
    const rows = yield* sql<{ id: string; displayName: string; rejoinCode: string }>`
      SELECT s.id, s.display_name AS "displayName", s.rejoin_code AS "rejoinCode"
      FROM student s JOIN assignment a ON a.id = s.assignment_id
      WHERE a.class_code = ${normaliseCode(classCode)} AND s.rejoin_code = ${normaliseCode(rejoinCode)}`
    const s = rows[0]
    if (s === undefined) return yield* new NotFound({ message: "no student with that class code and rejoin code" })
    const token = yield* issueToken(s.id)
    return { token, rejoinCode: s.rejoinCode, displayName: s.displayName }
  })

  const authenticate = (token: string) =>
    sql<{ id: string; assignmentId: string }>`SELECT id, assignment_id AS "assignmentId" FROM student WHERE token_hash = ${sha256(token)}`.pipe(
      Effect.map((r) => r[0])
    )

  const home = Effect.fn("Students.home")(function*(studentId: string) {
    const [me] = yield* sql<{ displayName: string; rejoinCode: string; title: string; status: "draft" | "open" | "closed"; classCode: string; studentView: StudentView; assignmentId: string }>`
      SELECT s.display_name AS "displayName", s.rejoin_code AS "rejoinCode", a.title, a.status, a.class_code AS "classCode",
             a.student_view AS "studentView", a.id AS "assignmentId"
      FROM student s JOIN assignment a ON a.id = s.assignment_id WHERE s.id = ${studentId}`
    const problems = yield* sql<{ id: string; position: number; prompt: string; maxPoints: number; items: unknown; referenceSolution: string }>`
      SELECT p.id, p.position, p.prompt_md AS prompt, p.max_points AS "maxPoints", r.items, r.reference_solution AS "referenceSolution"
      FROM problem p JOIN rubric r ON r.problem_id = p.id AND r.version = p.current_rubric_version
      WHERE p.assignment_id = ${me!.assignmentId} ORDER BY p.position`
    // Polled while a score is pending: kept small, so no strokes or images here.
    const subs = yield* sql<{ problemId: string; status: SubmissionStatus; verdicts: ReadonlyArray<StoredVerdict> | null; gradedItems: unknown; overrides: Record<string, boolean> | null }>`
      SELECT s.problem_id AS "problemId", s.status, g.verdicts, gr.items AS "gradedItems",
             (SELECT jsonb_object_agg(o.criterion_id, o.met) FROM override o WHERE o.submission_id = s.id) AS overrides
      FROM submission s
      LEFT JOIN LATERAL (SELECT * FROM grade WHERE submission_id = s.id ORDER BY rubric_version DESC LIMIT 1) g ON true
      LEFT JOIN rubric gr ON gr.problem_id = s.problem_id AND gr.version = g.rubric_version
      WHERE s.student_id = ${studentId}`
    return new StudentHome({
      studentId,
      assignmentTitle: me!.title,
      status: me!.status,
      displayName: me!.displayName,
      rejoinCode: me!.rejoinCode,
      classCode: me!.classCode,
      problems: problems.map((p) => {
        const s = subs.find((x) => x.problemId === p.id)
        if (s === undefined) return new StudentProblem({ id: p.id, position: p.position, prompt: p.prompt, maxPoints: p.maxPoints, submission: null })
        const rubric = decodeRubric({ items: s.gradedItems ?? p.items, referenceSolution: p.referenceSolution })
        const eff = effective(rubric.items, s.verdicts, s.overrides ?? {})
        const state = studentState(s.status, eff)
        const view = me!.studentView
        const labels = (met: boolean) => state === "graded" ? rubric.items.filter((i) => eff.met.get(i.id) === met).map((i) => i.label) : []
        return new StudentProblem({
          id: p.id,
          position: p.position,
          prompt: p.prompt,
          maxPoints: p.maxPoints,
          submission: {
            state,
            score: state === "graded" ? eff.score : null,
            // Task-framed labels: what the work did, and what isn't there yet (the default view).
            metLabels: view === "score" ? [] : labels(true),
            notYetLabels: view === "met_not_yet" ? labels(false) : []
          }
        })
      })
    })
  })

  const work = Effect.fn("Students.work")(function*(studentId: string, problemId: string) {
    const rows = yield* sql<{ strokes: unknown }>`SELECT strokes FROM submission WHERE student_id = ${studentId} AND problem_id::text = ${problemId}`
    if (rows[0] === undefined) return yield* new NotFound({ message: "no submission for that problem" })
    return { strokes: decodeStrokes(rows[0].strokes) }
  })

  const submit = Effect.fn("Students.submit")(function*(studentId: string, assignmentId: string, input: { problemId: string; idempotencyKey: string; strokes: Strokes; imagePng: Uint8Array }) {
    const rows = yield* sql<{ status: string; runId: string | null }>`
      SELECT a.status, a.run_id AS "runId" FROM problem p JOIN assignment a ON a.id = p.assignment_id
      WHERE p.id::text = ${input.problemId} AND a.id = ${assignmentId}`
    const a = rows[0]
    if (a === undefined) return yield* new NotFound({ message: "problem not found" })
    if (a.status !== "open") return yield* new AssignmentNotOpen({ message: "this assignment is closed" })
    // Load-test assignments carry a run_id; their submissions and jobs inherit it for analysis and cleanup.
    return yield* submissions.submit({ ...input, studentId, runId: a.runId ?? undefined })
  })

  return { join, rejoin, authenticate, home, work, submit }
})
