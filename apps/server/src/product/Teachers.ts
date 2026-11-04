import {
  AssignmentDetail,
  AssignmentSummary,
  CriterionDetail,
  CriterionStat,
  InvalidRequest,
  InvalidRubric,
  NotFound,
  type ProblemInput,
  ProblemStat,
  ProblemView,
  type StudentView,
  Report,
  ReportCell,
  ReportStudent,
  ReviewItem,
  Rubric,
  rubricProblems,
  SAMPLE_PROBLEMS,
  Strokes,
  SubmissionDetail,
  TemplateView
} from "@autograder/domain"
import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { RubricGenerator } from "../grading/RubricGenerator.ts"
import { newSecret, shortCode } from "./Codes.ts"
import { effective, reviewRisk, type StoredVerdict, type SubmissionStatus, templateRubric } from "./Scoring.ts"

const decodeRubric = Schema.decodeUnknownSync(Rubric)
const decodeStrokes = Schema.decodeUnknownSync(Strokes)

interface ProblemRow {
  readonly id: string
  readonly position: number
  readonly prompt: string
  readonly answerKey: string | null
  readonly maxPoints: number
  readonly version: number
  readonly items: unknown
  readonly referenceSolution: string
  readonly source: "generated" | "edited" | "sample" | "template"
}

const toProblemView = (r: ProblemRow) =>
  new ProblemView({
    id: r.id,
    position: r.position,
    prompt: r.prompt,
    answerKey: r.answerKey,
    maxPoints: r.maxPoints,
    rubric: decodeRubric({ items: r.items, referenceSolution: r.referenceSolution }),
    rubricVersion: r.version,
    rubricSource: r.source
  })

/**
 * Everything a teacher does, always scoped to their workspace: an assignment
 * that isn't theirs is NotFound, never Forbidden, so ids can't be probed (D-04).
 */
export class Teachers extends Context.Service<Teachers, Effect.Success<typeof make>>()(
  "autograder/Teachers"
) {
  static readonly layer = Layer.effect(Teachers, Effect.suspend(() => make))
}

const make = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const rubrics = yield* RubricGenerator
  const config = yield* AppConfig

  const problemsOf = (assignmentId: string) =>
    sql<ProblemRow>`
      SELECT p.id, p.position, p.prompt_md AS prompt, p.answer_key AS "answerKey", p.max_points AS "maxPoints",
             r.version, r.items, r.reference_solution AS "referenceSolution", r.source
      FROM problem p JOIN rubric r ON r.problem_id = p.id AND r.version = p.current_rubric_version
      WHERE p.assignment_id = ${assignmentId} ORDER BY p.position`

  const owned = Effect.fn("Teachers.owned")(function*(teacherId: string, assignmentId: string) {
    const rows = yield* sql<{ id: string; title: string; status: "draft" | "open" | "closed"; classCode: string | null; shareSlug: string | null; studentView: StudentView }>`
      SELECT id, title, status, class_code AS "classCode", share_slug AS "shareSlug", student_view AS "studentView"
      FROM assignment WHERE id::text = ${assignmentId} AND teacher_id = ${teacherId}`
    const a = rows[0]
    if (a === undefined) return yield* new NotFound({ message: "assignment not found" })
    return a
  })

  const detail = Effect.fn("Teachers.detail")(function*(teacherId: string, assignmentId: string, rubricFallbacks: ReadonlyArray<string> = []) {
    const a = yield* owned(teacherId, assignmentId)
    const problems = (yield* problemsOf(a.id)).map(toProblemView)
    return new AssignmentDetail({ ...a, problems, rubricFallbacks })
  })

  const insertAssignment = (teacherId: string, title: string, copiedFrom: string | null = null) =>
    sql<{ id: string }>`INSERT INTO assignment (teacher_id, title, copied_from) VALUES (${teacherId}, ${title}, ${copiedFrom}) RETURNING id`.pipe(
      Effect.map((r) => r[0]!.id)
    )

  const insertProblem = (assignmentId: string, position: number, p: { prompt: string; answerKey: string | null; maxPoints: number }, rubric: { items: unknown; referenceSolution: string }, source: ProblemRow["source"], model: string | null = null, promptVersion: string | null = null) =>
    Effect.gen(function*() {
      const [row] = yield* sql<{ id: string }>`
        INSERT INTO problem (assignment_id, position, prompt_md, answer_key, max_points)
        VALUES (${assignmentId}, ${position}, ${p.prompt}, ${p.answerKey}, ${p.maxPoints}) RETURNING id`
      yield* sql`INSERT INTO rubric (problem_id, version, items, reference_solution, source, model, prompt_version)
                 VALUES (${row!.id}, 1, ${JSON.stringify(rubric.items)}::jsonb, ${rubric.referenceSolution}, ${source}, ${model}, ${promptVersion})`
    })

  /** Drafts every rubric in parallel (D-08); a problem whose draft fails gets a template, never blocks the teacher. */
  const create = Effect.fn("Teachers.create")(function*(teacherId: string, title: string, problems: ReadonlyArray<ProblemInput>) {
    const drafts = yield* Effect.forEach(problems, (p) =>
      rubrics.generate(p).pipe(
        Effect.timeout(Duration.seconds(30)),
        Effect.map((r) => ({ ok: true as const, rubric: r.rubric, model: r.model, promptVersion: r.promptVersion })),
        Effect.catch((e) =>
          Effect.logWarning("rubric draft failed; using a template", e).pipe(Effect.as({ ok: false as const, rubric: templateRubric(p.answerKey, p.maxPoints), model: null, promptVersion: null }))
        )
      ), { concurrency: 5 })
    const assignmentId = yield* sql.withTransaction(Effect.gen(function*() {
      const id = yield* insertAssignment(teacherId, title)
      for (const [i, p] of problems.entries()) {
        const d = drafts[i]!
        yield* insertProblem(id, i + 1, p, d.rubric, d.ok ? "generated" : "template", d.model, d.promptVersion)
      }
      return id
    }))
    const fallbacks: Array<string> = []
    const created = yield* problemsOf(assignmentId)
    drafts.forEach((d, i) => { if (!d.ok) fallbacks.push(created[i]!.id) })
    return yield* detail(teacherId, assignmentId, fallbacks)
  })

  /** One-click sample (D-09): reviewed rubrics, no model call, instant. */
  const createSample = Effect.fn("Teachers.createSample")(function*(teacherId: string) {
    const id = yield* sql.withTransaction(Effect.gen(function*() {
      const id = yield* insertAssignment(teacherId, "Algebra 1: Solving equations (sample)")
      for (const [i, p] of SAMPLE_PROBLEMS.entries()) yield* insertProblem(id, i + 1, p, p.rubric, "sample")
      return id
    }))
    return yield* detail(teacherId, id)
  })

  const list = Effect.fn("Teachers.list")(function*(teacherId: string) {
    const rows = yield* sql<{
      id: string; title: string; status: "draft" | "open" | "closed"; classCode: string | null; createdAt: Date
      studentCount: number
    }>`
      SELECT a.id, a.title, a.status, a.class_code AS "classCode", a.created_at AS "createdAt",
        (SELECT count(*)::int FROM student s WHERE s.assignment_id = a.id) AS "studentCount"
      FROM assignment a WHERE a.teacher_id = ${teacherId} ORDER BY a.created_at DESC`
    // Same counting as the report (overrides included), so the two never disagree.
    return yield* Effect.forEach(rows, (r) =>
      Effect.gen(function*() {
        const problems = (yield* problemsOf(r.id)).map(toProblemView)
        const { risks, graded } = evaluate(problems, yield* submissionsOf(r.id))
        return new AssignmentSummary({
          ...r,
          createdAt: DateTime.fromDateUnsafe(r.createdAt),
          problemCount: problems.length,
          gradedCount: graded,
          reviewCount: risks.length
        })
      }), { concurrency: 4 })
  })

  /** Every edit is a new version; grades keep the version they used (D-10). */
  const saveRubric = Effect.fn("Teachers.saveRubric")(function*(teacherId: string, problemId: string, rubric: Rubric) {
    const rows = yield* sql<{ assignmentId: string; maxPoints: number; version: number }>`
      SELECT p.assignment_id AS "assignmentId", p.max_points AS "maxPoints", p.current_rubric_version AS version
      FROM problem p JOIN assignment a ON a.id = p.assignment_id
      WHERE p.id::text = ${problemId} AND a.teacher_id = ${teacherId}`
    const p = rows[0]
    if (p === undefined) return yield* new NotFound({ message: "problem not found" })
    const problems = rubricProblems(rubric, p.maxPoints)
    if (problems.length > 0) return yield* new InvalidRubric({ problems })
    const next = p.version + 1
    yield* sql.withTransaction(Effect.gen(function*() {
      yield* sql`INSERT INTO rubric (problem_id, version, items, reference_solution, source)
                 VALUES (${problemId}, ${next}, ${JSON.stringify(rubric.items)}::jsonb, ${rubric.referenceSolution}, 'edited')`
      yield* sql`UPDATE problem SET current_rubric_version = ${next} WHERE id = ${problemId}`
    }))
    const view = (yield* problemsOf(p.assignmentId)).find((r) => r.id === problemId)!
    return toProblemView(view)
  })

  const publish = Effect.fn("Teachers.publish")(function*(teacherId: string, assignmentId: string) {
    const a = yield* owned(teacherId, assignmentId)
    if (a.classCode === null) {
      // Unique-constraint retry: a 6-char code from a 31-char alphabet has ~887M values.
      yield* Effect.gen(function*() {
        yield* sql`UPDATE assignment SET class_code = ${shortCode()}, status = 'open', published_at = now() WHERE id = ${a.id}`
      }).pipe(Effect.retry({ times: 3 }))
    } else {
      yield* sql`UPDATE assignment SET status = 'open' WHERE id = ${a.id}`
    }
    return yield* detail(teacherId, a.id)
  })

  const close = Effect.fn("Teachers.close")(function*(teacherId: string, assignmentId: string) {
    const a = yield* owned(teacherId, assignmentId)
    yield* sql`UPDATE assignment SET status = 'closed' WHERE id = ${a.id}`
    return yield* detail(teacherId, a.id)
  })

  const setStudentView = Effect.fn("Teachers.setStudentView")(function*(teacherId: string, assignmentId: string, view: StudentView) {
    const a = yield* owned(teacherId, assignmentId)
    yield* sql`UPDATE assignment SET student_view = ${view} WHERE id = ${a.id}`
    return yield* detail(teacherId, a.id)
  })

  /** Share-with-a-colleague link: problems and rubrics only, never student data. */
  const share = Effect.fn("Teachers.share")(function*(teacherId: string, assignmentId: string) {
    const a = yield* owned(teacherId, assignmentId)
    if (a.shareSlug !== null) return { slug: a.shareSlug }
    const slug = newSecret().slice(0, 12)
    yield* sql`UPDATE assignment SET share_slug = ${slug} WHERE id = ${a.id}`
    return { slug }
  })

  const templateBySlug = Effect.fn("Teachers.templateBySlug")(function*(slug: string) {
    const rows = yield* sql<{ id: string; title: string }>`SELECT id, title FROM assignment WHERE share_slug = ${slug}`
    const a = rows[0]
    if (a === undefined) return yield* new NotFound({ message: "shared assignment not found" })
    const problems = (yield* problemsOf(a.id)).map(toProblemView)
    return {
      id: a.id,
      view: new TemplateView({
        title: a.title,
        problems: problems.map((p) => ({ prompt: p.prompt, answerKey: p.answerKey, maxPoints: p.maxPoints, rubric: p.rubric }))
      })
    }
  })

  const copyTemplate = Effect.fn("Teachers.copyTemplate")(function*(teacherId: string, slug: string) {
    const t = yield* templateBySlug(slug)
    const id = yield* sql.withTransaction(Effect.gen(function*() {
      const id = yield* insertAssignment(teacherId, t.view.title, t.id)
      for (const [i, p] of t.view.problems.entries()) yield* insertProblem(id, i + 1, p, p.rubric, "template")
      return id
    }))
    return yield* detail(teacherId, id)
  })

  // --- report and review ------------------------------------------------------

  interface SubRow {
    readonly id: string
    readonly studentId: string
    readonly problemId: string
    readonly status: SubmissionStatus
    readonly reviewReason: string | null
    readonly verdicts: ReadonlyArray<StoredVerdict> | null
    readonly confidence: "high" | "medium" | "low" | null
    readonly gradedVersion: number | null
    readonly gradedItems: ReadonlyArray<{ id: string; label: string; points: number }> | null
    readonly overrides: Record<string, boolean> | null
  }

  const submissionsOf = (assignmentId: string) =>
    sql<SubRow>`
      SELECT s.id, s.student_id AS "studentId", s.problem_id AS "problemId", s.status, s.review_reason AS "reviewReason",
             g.verdicts, g.confidence, g.rubric_version AS "gradedVersion", gr.items AS "gradedItems",
             (SELECT jsonb_object_agg(o.criterion_id, o.met) FROM override o WHERE o.submission_id = s.id) AS overrides
      FROM submission s
      JOIN problem p ON p.id = s.problem_id
      LEFT JOIN LATERAL (SELECT * FROM grade WHERE submission_id = s.id ORDER BY rubric_version DESC LIMIT 1) g ON true
      LEFT JOIN rubric gr ON gr.problem_id = s.problem_id AND gr.version = g.rubric_version
      WHERE p.assignment_id = ${assignmentId}`

  /**
   * Effective state of every submission: model verdicts plus teacher overrides.
   * The report and the assignment list both count from this, so they always agree.
   */
  const evaluate = (problems: ReadonlyArray<ProblemView>, subs: ReadonlyArray<SubRow>) => {
    const evaluated = new Map(subs.map((s) => {
      const problem = problems.find((p) => p.id === s.problemId)!
      // Score against the rubric the grade used; ungraded work uses the current rubric.
      const items = s.gradedItems ?? problem.rubric.items
      const eff = effective(items, s.verdicts, s.overrides ?? {})
      const stale = s.gradedVersion !== null && s.gradedVersion < problem.rubricVersion
      return [s.id, { eff, stale, items }] as const
    }))
    const risks = subs.flatMap((s) => {
      const { eff, stale } = evaluated.get(s.id)!
      const r = reviewRisk({ status: s.status, reviewReason: s.reviewReason, confidence: s.confidence, staleRubric: stale, overridden: eff.overridden, score: eff.score })
      return r === null ? [] : [{ s, r }]
    })
    const graded = subs.filter((s) => s.status !== "queued" && s.status !== "grading" && evaluated.get(s.id)!.eff.score !== null).length
    return { evaluated, risks, graded }
  }

  /** The class at a glance: grid, averages, per-criterion misses, risk-ranked queue. */
  const report = Effect.fn("Teachers.report")(function*(teacherId: string, assignmentId: string) {
    const a = yield* owned(teacherId, assignmentId)
    const problems = (yield* problemsOf(a.id)).map(toProblemView)
    const students = yield* sql<{ id: string; displayName: string; rejoinCode: string }>`
      SELECT id, display_name AS "displayName", rejoin_code AS "rejoinCode" FROM student
      WHERE assignment_id = ${a.id} ORDER BY lower(display_name), created_at`
    const subs = yield* submissionsOf(a.id)
    const names = new Map(students.map((s) => [s.id, s.displayName]))
    const byKey = new Map(subs.map((s) => [`${s.studentId}:${s.problemId}`, s]))

    const { evaluated, risks, graded } = evaluate(problems, subs)

    const reviewQueue = risks.flatMap(({ s, r }) => {
      return [new ReviewItem({
        submissionId: s.id,
        studentName: names.get(s.studentId) ?? "?",
        problemPosition: problems.find((p) => p.id === s.problemId)!.position,
        ...r
      })]
    }).sort((x, y) => y.risk - x.risk || x.problemPosition - y.problemPosition)

    const reportStudents = students.map((st) => {
      const cells = problems.map((p) => {
        const s = byKey.get(`${st.id}:${p.id}`)
        if (s === undefined) return new ReportCell({ problemId: p.id, submissionId: null, status: "not_started", score: null, overridden: false, staleRubric: false })
        const { eff, stale } = evaluated.get(s.id)!
        const status = s.status === "queued" || s.status === "grading" ? "grading" : eff.score !== null ? "graded" : "needs_review"
        return new ReportCell({ problemId: p.id, submissionId: s.id, status, score: eff.score, overridden: eff.overridden, staleRubric: stale })
      })
      return new ReportStudent({
        ...st,
        cells,
        total: cells.reduce((sum, c) => sum + (c.score ?? 0), 0),
        maxPossible: problems.reduce((sum, p) => sum + p.maxPoints, 0),
        submitted: cells.filter((c) => c.status !== "not_started").length
      })
    })

    const problemStats = problems.map((p) => {
      const scored = subs.filter((s) => s.problemId === p.id).map((s) => evaluated.get(s.id)!).filter((e) => e.eff.score !== null)
      return new ProblemStat({
        id: p.id,
        position: p.position,
        prompt: p.prompt,
        maxPoints: p.maxPoints,
        graded: scored.length,
        average: scored.length === 0 ? null : scored.reduce((sum, e) => sum + e.eff.score!, 0) / scored.length,
        // Miss rates per CURRENT criterion, over work graded with a rubric that has it.
        criteria: p.rubric.items.map((item) => {
          const judged = scored.filter((e) => e.eff.met.has(item.id))
          return new CriterionStat({ id: item.id, label: item.label, points: item.points, judged: judged.length, missed: judged.filter((e) => e.eff.met.get(item.id) === false).length })
        })
      })
    })

    return new Report({
      assignmentId: a.id,
      title: a.title,
      status: a.status,
      classCode: a.classCode,
      problems: problemStats,
      students: reportStudents,
      reviewQueue,
      graded,
      worthALook: reviewQueue.length
    })
  })

  const submissionDetail = Effect.fn("Teachers.submissionDetail")(function*(teacherId: string, submissionId: string) {
    const rows = yield* sql<{
      id: string; assignmentId: string; problemId: string; studentName: string; strokes: unknown; status: SubmissionStatus; reviewReason: string | null
      transcription: string | null; confidence: "high" | "medium" | "low" | null; model: string | null; provider: string | null; verdicts: ReadonlyArray<StoredVerdict> | null
      gradedVersion: number | null; gradedItems: unknown; gradedRef: string | null; overrides: Record<string, boolean> | null
    }>`
      SELECT s.id, p.assignment_id AS "assignmentId", s.problem_id AS "problemId", st.display_name AS "studentName", s.strokes,
             s.status, s.review_reason AS "reviewReason", g.transcription, g.confidence, g.model, g.provider, g.verdicts,
             g.rubric_version AS "gradedVersion", gr.items AS "gradedItems", gr.reference_solution AS "gradedRef",
             (SELECT jsonb_object_agg(o.criterion_id, o.met) FROM override o WHERE o.submission_id = s.id) AS overrides
      FROM submission s
      JOIN problem p ON p.id = s.problem_id
      JOIN assignment a ON a.id = p.assignment_id
      JOIN student st ON st.id = s.student_id
      LEFT JOIN LATERAL (SELECT * FROM grade WHERE submission_id = s.id ORDER BY rubric_version DESC LIMIT 1) g ON true
      LEFT JOIN rubric gr ON gr.problem_id = s.problem_id AND gr.version = g.rubric_version
      WHERE s.id::text = ${submissionId} AND a.teacher_id = ${teacherId}`
    const s = rows[0]
    if (s === undefined) return yield* new NotFound({ message: "submission not found" })
    const problem = toProblemView((yield* problemsOf(s.assignmentId)).find((p) => p.id === s.problemId)!)
    const rubric = s.gradedItems !== null ? decodeRubric({ items: s.gradedItems, referenceSolution: s.gradedRef ?? "" }) : problem.rubric
    const eff = effective(rubric.items, s.verdicts, s.overrides ?? {})
    const fromModel = new Map((s.verdicts ?? []).map((v) => [v.id, v]))
    return new SubmissionDetail({
      id: s.id,
      studentName: s.studentName,
      problem,
      strokes: decodeStrokes(s.strokes),
      status: s.status === "queued" || s.status === "grading" ? "grading" : eff.score !== null ? "graded" : "needs_review",
      reviewReason: s.reviewReason,
      transcription: s.transcription,
      confidence: s.confidence,
      model: s.model,
      provider: s.provider,
      usedFallback: s.model !== null && config.model.gradingFallbackModels.includes(s.model),
      criteria: rubric.items.map((i) => new CriterionDetail({
        id: i.id,
        label: i.label,
        description: i.description,
        points: i.points,
        modelMet: fromModel.get(i.id)?.met ?? null,
        evidence: fromModel.get(i.id)?.evidence ?? null,
        override: s.overrides?.[i.id] ?? null,
        met: eff.met.get(i.id) ?? null
      })),
      score: eff.score,
      maxPoints: rubric.items.reduce((sum, i) => sum + i.points, 0),
      gradedWithRubricVersion: s.gradedVersion
    })
  })

  /** One click per criterion; code recomputes the total, the student's view follows. */
  const override = Effect.fn("Teachers.override")(function*(teacherId: string, submissionId: string, criterionId: string, met: boolean) {
    const before = yield* submissionDetail(teacherId, submissionId)
    if (!before.criteria.some((c) => c.id === criterionId)) return yield* new InvalidRequest({ message: `unknown criterion ${criterionId}` })
    yield* sql`INSERT INTO override (submission_id, criterion_id, met) VALUES (${submissionId}, ${criterionId}, ${met})
               ON CONFLICT (submission_id, criterion_id) DO UPDATE SET met = EXCLUDED.met, created_at = now()`
    return yield* submissionDetail(teacherId, submissionId)
  })

  return {
    list, create, createSample, detail, saveRubric, publish, close, setStudentView, share,
    templateBySlug, copyTemplate, report, submissionDetail, override
  }
})
