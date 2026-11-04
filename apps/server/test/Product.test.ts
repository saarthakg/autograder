import { Api, ProblemInput, Rubric, RubricItem } from "@autograder/domain"
import { assert, describe, layer } from "@effect/vitest"
import { Effect } from "effect"
import { HttpApiTest } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { PNG, resetDb, STROKES } from "./support/Seed.ts"
import { TestApp, withTokens } from "./support/TestApp.ts"

const makeClient = HttpApiTest.groups(Api, ["public", "teacher", "student"])

/** A teacher with a published sample assignment and one joined student. */
const classroom = Effect.gen(function*() {
  yield* resetDb
  const anon = yield* makeClient.pipe(Effect.provide(withTokens()))
  const workspace = yield* anon.public.createWorkspace()
  const teacher = yield* makeClient.pipe(Effect.provide(withTokens({ teacher: workspace.secret })))
  const draft = yield* teacher.teacher.createSample()
  const published = yield* teacher.teacher.publish({ params: { id: draft.id } })
  const joined = yield* anon.public.join({ payload: { classCode: published.classCode!.toLowerCase(), displayName: "  Ada   L " } })
  const student = yield* makeClient.pipe(Effect.provide(withTokens({ student: joined.token })))
  return { anon, teacher, student, workspace, assignment: published, joined }
})

/** Stands in for the grading worker: writes a grade the way GradeJob does. */
const gradeDirectly = (submissionId: string, verdicts: Array<boolean>, opts: { legible?: boolean; confidence?: string } = {}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const legible = opts.legible ?? true
    const v = verdicts.map((met, i) => ({ id: `c${i + 1}`, met, evidence: "line" }))
    yield* sql`INSERT INTO grade (submission_id, rubric_version, model, prompt_version, transcription, legible, confidence, verdicts, total_points, max_points, model_started_at, model_finished_at)
               SELECT ${submissionId}, p.current_rubric_version, 'test', 'grade.v2', 'work', ${legible}, ${opts.confidence ?? "high"}, ${JSON.stringify(legible ? v : [])}::jsonb, 0, 0, now(), now()
               FROM submission s JOIN problem p ON p.id = s.problem_id WHERE s.id = ${submissionId}`
    yield* sql`UPDATE submission SET status = ${legible ? "graded" : "needs_review"}, review_reason = ${legible ? null : "illegible"}, graded_at = now() WHERE id = ${submissionId}`
  })

layer(TestApp, { excludeTestServices: true })("teacher and student product (real Postgres)", (it) => {
  describe("teacher setup", () => {
    it.effect("sample gives reviewed rubrics instantly; publishing issues an unambiguous class code", () =>
      Effect.gen(function*() {
        const { assignment } = yield* classroom
        assert.strictEqual(assignment.status, "open")
        assert.strictEqual(assignment.problems.length, 3)
        assert.isTrue(assignment.problems.every((p) => p.rubricSource === "sample"))
        assert.match(assignment.classCode!, /^[A-HJKMNP-Z2-9]{6}$/)
      }))

    it.effect("a drafted rubric that fails falls back to an editable template, never blocking the teacher (D-08)", () =>
      Effect.gen(function*() {
        const { teacher } = yield* classroom
        const created = yield* teacher.teacher.createAssignment({
          payload: { title: "Quiz", problems: [new ProblemInput({ prompt: "Solve 2x = 8", answerKey: "x = 4", maxPoints: 2 })] }
        })
        assert.strictEqual(created.rubricFallbacks.length, 1)
        assert.strictEqual(created.problems[0]!.rubricSource, "template")
        assert.strictEqual(created.problems[0]!.rubric.items[0]!.points, 2)
      }))

    it.effect("rubric edits are validated and versioned", () =>
      Effect.gen(function*() {
        const { teacher, assignment } = yield* classroom
        const p2 = assignment.problems[1]!
        const bad = new Rubric({ items: [new RubricItem({ id: "c1", label: "x", description: "y", points: 5 })], referenceSolution: "r" })
        const err = yield* teacher.teacher.saveRubric({ params: { id: p2.id }, payload: bad }).pipe(Effect.flip)
        assert.strictEqual(err._tag, "InvalidRubric")
        const good = new Rubric({ items: [new RubricItem({ id: "c1", label: "Solves it", description: "x < -4", points: 3 })], referenceSolution: "r" })
        const saved = yield* teacher.teacher.saveRubric({ params: { id: p2.id }, payload: good })
        assert.strictEqual(saved.rubricVersion, 2)
        assert.strictEqual(saved.rubricSource, "edited")
      }))

    it.effect("another teacher's link sees nothing (D-04)", () =>
      Effect.gen(function*() {
        const { anon, assignment } = yield* classroom
        const other = yield* anon.public.createWorkspace()
        const intruder = yield* makeClient.pipe(Effect.provide(withTokens({ teacher: other.secret })))
        const err = yield* intruder.teacher.report({ params: { id: assignment.id } }).pipe(Effect.flip)
        assert.strictEqual(err._tag, "NotFound")
        assert.deepStrictEqual(yield* intruder.teacher.listAssignments(), [])
      }))
  })

  describe("students", () => {
    it.effect("join normalises the code and name, and rejoin moves the student to a new device", () =>
      Effect.gen(function*() {
        const { anon, student, assignment, joined } = yield* classroom
        assert.strictEqual(joined.displayName, "Ada L")
        const home = yield* student.student.home()
        assert.strictEqual(home.problems.length, 3)
        const again = yield* anon.public.rejoin({ payload: { classCode: assignment.classCode!, rejoinCode: joined.rejoinCode.toLowerCase() } })
        assert.notStrictEqual(again.token, joined.token)
        const stale = yield* student.student.home().pipe(Effect.flip)
        assert.strictEqual(stale._tag, "Unauthorized") // old device's token is revoked
      }))

    it.effect("a name already in the class is refused, trimmed and case-insensitive", () =>
      Effect.gen(function*() {
        const { anon, assignment } = yield* classroom // "Ada L" already joined
        const err = yield* anon.public.join({ payload: { classCode: assignment.classCode!, displayName: "  ada   l " } }).pipe(Effect.flip)
        assert.strictEqual(err._tag, "NameTaken")
        const ok = yield* anon.public.join({ payload: { classCode: assignment.classCode!, displayName: "Ada K" } })
        assert.strictEqual(ok.displayName, "Ada K")
      }))

    it.effect("closed assignments refuse joins and submissions", () =>
      Effect.gen(function*() {
        const { anon, teacher, student, assignment } = yield* classroom
        yield* teacher.teacher.close({ params: { id: assignment.id } })
        const joinErr = yield* anon.public.join({ payload: { classCode: assignment.classCode!, displayName: "Bo" } }).pipe(Effect.flip)
        assert.strictEqual(joinErr._tag, "AssignmentNotOpen")
        const submitErr = yield* student.student.submit({
          payload: { problemId: assignment.problems[0]!.id, idempotencyKey: "closed-key-1", strokes: STROKES, imagePng: PNG }
        }).pipe(Effect.flip)
        assert.strictEqual(submitErr._tag, "AssignmentNotOpen")
      }))
  })

  describe("grading loop: submit -> score -> report -> override", () => {
    it.effect("student sees met criteria only; teacher overrides one click; both views follow (D-01)", () =>
      Effect.gen(function*() {
        const { teacher, student, assignment } = yield* classroom
        const p1 = assignment.problems[0]!
        const accepted = yield* student.student.submit({ payload: { problemId: p1.id, idempotencyKey: "grade-loop-1", strokes: STROKES, imagePng: PNG } })
        let home = yield* student.student.home()
        assert.strictEqual(home.problems[0]!.submission!.state, "grading")

        yield* gradeDirectly(accepted.id, [true, false, true]) // 1 + 0 + 2 = 3 / 4
        home = yield* student.student.home()
        assert.strictEqual(home.problems[0]!.submission!.score, 3)
        assert.deepStrictEqual(home.problems[0]!.submission!.metLabels, [p1.rubric.items[0]!.label, p1.rubric.items[2]!.label])

        let report = yield* teacher.teacher.report({ params: { id: assignment.id } })
        assert.strictEqual(report.students[0]!.cells[0]!.score, 3)
        const c2 = report.problems[0]!.criteria.find((c) => c.id === "c2")!
        assert.deepStrictEqual([c2.missed, c2.judged], [1, 1])

        const detail = yield* teacher.teacher.override({ params: { id: accepted.id, criterionId: "c2" }, payload: { met: true } })
        assert.strictEqual(detail.score, 4)
        report = yield* teacher.teacher.report({ params: { id: assignment.id } })
        assert.isTrue(report.students[0]!.cells[0]!.overridden)
        home = yield* student.student.home()
        assert.strictEqual(home.problems[0]!.submission!.score, 4)
      }))

    it.effect("unreadable work goes to the review queue, shows 'teacher will check', and hand grading completes it (D-06)", () =>
      Effect.gen(function*() {
        const { teacher, student, assignment } = yield* classroom
        const p1 = assignment.problems[0]!
        const accepted = yield* student.student.submit({ payload: { problemId: p1.id, idempotencyKey: "illegible-key-1", strokes: STROKES, imagePng: PNG } })
        yield* gradeDirectly(accepted.id, [], { legible: false })
        assert.strictEqual((yield* student.student.home()).problems[0]!.submission!.state, "teacher_check")
        let report = yield* teacher.teacher.report({ params: { id: assignment.id } })
        assert.deepStrictEqual(report.reviewQueue.map((r) => r.reason), ["illegible"])
        let [summary] = yield* teacher.teacher.listAssignments()
        assert.deepStrictEqual([summary!.gradedCount, summary!.reviewCount], [0, 1])
        for (const c of ["c1", "c2", "c3"]) yield* teacher.teacher.override({ params: { id: accepted.id, criterionId: c }, payload: { met: c !== "c2" } })
        const home = yield* student.student.home()
        assert.deepStrictEqual([home.problems[0]!.submission!.state, home.problems[0]!.submission!.score], ["graded", 3])
        report = yield* teacher.teacher.report({ params: { id: assignment.id } })
        assert.strictEqual(report.reviewQueue.length, 0)
        // The list counts the same way as the report: resolved by hand means graded, nothing to check.
        ;[summary] = yield* teacher.teacher.listAssignments()
        assert.deepStrictEqual([summary!.gradedCount, summary!.reviewCount], [report.graded, report.worthALook])
        assert.deepStrictEqual([summary!.gradedCount, summary!.reviewCount], [1, 0])
      }))

    it.effect("the teacher picks what students see: score only, met (default), or met + Not yet (D-01)", () =>
      Effect.gen(function*() {
        const { teacher, student, assignment } = yield* classroom
        const p1 = assignment.problems[0]!
        const [l1, l2, l3] = p1.rubric.items.map((i) => i.label)
        assert.strictEqual(assignment.studentView, "met")
        const accepted = yield* student.student.submit({ payload: { problemId: p1.id, idempotencyKey: "student-view-1", strokes: STROKES, imagePng: PNG } })
        yield* gradeDirectly(accepted.id, [true, false, true])
        const seen = Effect.map(student.student.home(), (h) => h.problems[0]!.submission!)

        let sub = yield* seen
        assert.deepStrictEqual([sub.score, sub.metLabels, sub.notYetLabels], [3, [l1, l3], []])
        // Their own work is a separate, one-time fetch: polling stays small (no strokes in home).
        assert.strictEqual((yield* student.student.work({ params: { id: p1.id } })).strokes.length, STROKES.length)

        yield* teacher.teacher.setStudentView({ params: { id: assignment.id }, payload: { studentView: "met_not_yet" } })
        sub = yield* seen
        assert.deepStrictEqual([sub.metLabels, sub.notYetLabels], [[l1, l3], [l2]])

        const updated = yield* teacher.teacher.setStudentView({ params: { id: assignment.id }, payload: { studentView: "score" } })
        assert.strictEqual(updated.studentView, "score")
        sub = yield* seen
        assert.deepStrictEqual([sub.score, sub.metLabels, sub.notYetLabels], [3, [], []])
      }))
  })

  describe("share with a colleague", () => {
    it.effect("the template carries problems and rubrics, and copying makes the colleague's own draft", () =>
      Effect.gen(function*() {
        const { anon, teacher, assignment } = yield* classroom
        const { slug } = yield* teacher.teacher.share({ params: { id: assignment.id } })
        const template = yield* anon.public.getTemplate({ params: { slug } })
        assert.strictEqual(template.problems.length, 3)
        const colleague = yield* anon.public.createWorkspace()
        const theirs = yield* makeClient.pipe(Effect.provide(withTokens({ teacher: colleague.secret })))
        const copy = yield* theirs.teacher.copyTemplate({ params: { slug } })
        assert.strictEqual(copy.status, "draft")
        assert.notStrictEqual(copy.id, assignment.id)
        assert.isTrue(copy.problems.every((p) => p.rubricSource === "template"))
      }))
  })
})
