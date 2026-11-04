import { CriterionVerdict, GradeOutput } from "@autograder/domain"
import { assert, describe, layer } from "@effect/vitest"
import { Duration, Effect, Exit, Layer, Scope } from "effect"
import { SqlClient } from "effect/sql"
import { Grader, type GradeResult, InvalidModelOutput } from "../src/grading/Grader.ts"
import { makeGradeHandler } from "../src/grading/GradeJob.ts"
import { Submissions } from "../src/grading/Submissions.ts"
import { Instance } from "../src/Instance.ts"
import { ModelError } from "../src/model/ModelClient.ts"
import { JobQueue } from "../src/queue/JobQueue.ts"
import { JobHandlers } from "../src/worker/JobHandlers.ts"
import { WakeSignal } from "../src/worker/WakeSignal.ts"
import { WorkerLive } from "../src/worker/Worker.ts"
import { PNG, resetDb, seedClass, STROKES } from "./support/Seed.ts"
import { testConfig } from "./support/TestConfig.ts"
import { TestDb } from "./support/TestDb.ts"

const result = (verdicts: Array<"met" | "not_met">, legible = true): GradeResult => {
  const output = new GradeOutput({
    transcription: "3x - 6 = 2x + 5",
    legible,
    criteria: legible ? verdicts.map((v, i) => new CriterionVerdict({ id: `c${i + 1}`, verdict: v, evidence: "l1" })) : [],
    confidence: "high"
  })
  const met = new Map(output.criteria.map((c) => [c.id, c.verdict === "met"]))
  const weights = [1, 1, 2]
  return {
    output,
    met,
    totalPoints: verdicts.reduce((s, v, i) => s + (legible && v === "met" ? weights[i]! : 0), 0),
    maxPoints: 4,
    model: "test/grader",
    provider: "TestCo",
    promptVersion: "grade.v1",
    startedAt: new Date(),
    finishedAt: new Date(),
    calls: []
  }
}

type Outcome = GradeResult | InvalidModelOutput | ModelError
let nextOutcome: Outcome = result(["met", "met", "met"])
const FakeGrader = Layer.succeed(Grader, Grader.of({
  grade: () => nextOutcome instanceof InvalidModelOutput || nextOutcome instanceof ModelError ? Effect.fail(nextOutcome) : Effect.succeed(nextOutcome)
}))

const Base = Layer.mergeAll(Submissions.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(JobQueue.layer, WakeSignal.layer, Instance.layer, FakeGrader)),
  Layer.provideMerge(TestDb)
)

/** Runs the real worker with the real grade handler (fake grader) until the submission is terminal. */
const gradeToTerminal = (submissionId: string) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const handlers = Layer.effect(JobHandlers, Effect.map(makeGradeHandler, (grade) => new Map([["grade", grade]])))
    yield* Layer.buildWithScope(WorkerLive.pipe(Layer.provide([handlers, testConfig()])), scope)
    const sql = yield* SqlClient.SqlClient
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const [row] = yield* sql<{ status: string }>`SELECT status FROM submission WHERE id = ${submissionId}`
      if (row && (row.status === "graded" || row.status === "needs_review")) break
      yield* Effect.sleep(Duration.millis(25))
    }
    yield* Scope.close(scope, Exit.void)
    const [sub] = yield* sql<{ status: string; reviewReason: string | null; hasImage: boolean; gradedAt: Date | null }>`
      SELECT status, review_reason AS "reviewReason", image IS NOT NULL AS "hasImage", graded_at AS "gradedAt"
      FROM submission WHERE id = ${submissionId}`
    const grades = yield* sql<{ totalPoints: number; maxPoints: number; modelStartedAt: Date }>`
      SELECT total_points AS "totalPoints", max_points AS "maxPoints", model_started_at AS "modelStartedAt"
      FROM grade WHERE submission_id = ${submissionId}`
    return { sub: sub!, grades }
  })

const submitOne = (key: string = crypto.randomUUID()) =>
  Effect.gen(function*() {
    yield* resetDb
    const ids = yield* seedClass
    const submissions = yield* Submissions
    const res = yield* submissions.submit({ studentId: ids.studentId, problemId: ids.problemId, idempotencyKey: key, strokes: STROKES, imagePng: PNG })
    return { ids, res }
  })

layer(Base, { excludeTestServices: true })("submission path (real Postgres)", (it) => {
  describe("submit", () => {
    it.effect("writes the submission and its grade job together (P22)", () =>
      Effect.gen(function*() {
        const { res } = yield* submitOne()
        assert.isTrue(res.created)
        const sql = yield* SqlClient.SqlClient
        const jobs = yield* sql<{ kind: string }>`SELECT kind FROM job WHERE dedupe_key = ${`grade:${res.id}`}`
        assert.deepStrictEqual(jobs.map((j) => j.kind), ["grade"])
      }))

    it.effect("a retried request with the same key returns the same submission (P23)", () =>
      Effect.gen(function*() {
        const { ids, res } = yield* submitOne("same-key")
        const again = yield* (yield* Submissions).submit({ studentId: ids.studentId, problemId: ids.problemId, idempotencyKey: "same-key", strokes: STROKES, imagePng: PNG })
        assert.strictEqual(again.id, res.id)
        assert.isFalse(again.created)
        const sql = yield* SqlClient.SqlClient
        const [n] = yield* sql<{ n: number }>`SELECT count(*)::int AS n FROM job`
        assert.strictEqual(n!.n, 1)
      }))

    it.effect("a second attempt at the same problem is refused (D-02)", () =>
      Effect.gen(function*() {
        const { ids } = yield* submitOne()
        const err = yield* (yield* Submissions).submit({ studentId: ids.studentId, problemId: ids.problemId, idempotencyKey: "other", strokes: STROKES, imagePng: PNG }).pipe(Effect.flip)
        assert.strictEqual(err._tag, "AlreadySubmitted")
      }))

    it.effect("rejects a non-PNG image and an empty drawing", () =>
      Effect.gen(function*() {
        yield* resetDb
        const ids = yield* seedClass
        const s = yield* Submissions
        const base = { studentId: ids.studentId, problemId: ids.problemId, idempotencyKey: "k", strokes: STROKES }
        assert.strictEqual((yield* s.submit({ ...base, imagePng: new Uint8Array([1, 2, 3]) }).pipe(Effect.flip))._tag, "InvalidSubmission")
        assert.strictEqual((yield* s.submit({ ...base, strokes: [], imagePng: PNG }).pipe(Effect.flip))._tag, "InvalidSubmission")
      }))
  })

  describe("grade job", () => {
    it.effect("grades it: weighted total from code, timestamps set, image purged", () =>
      Effect.gen(function*() {
        nextOutcome = result(["met", "not_met", "met"])
        const { res } = yield* submitOne()
        const { sub, grades } = yield* gradeToTerminal(res.id)
        assert.strictEqual(sub.status, "graded")
        assert.isFalse(sub.hasImage)
        assert.isNotNull(sub.gradedAt)
        assert.strictEqual(grades.length, 1)
        assert.strictEqual(grades[0]!.totalPoints, 3)
        assert.strictEqual(grades[0]!.maxPoints, 4)
      }))

    it.effect("an abstention goes to the teacher as illegible, with no score shown (P9)", () =>
      Effect.gen(function*() {
        nextOutcome = result([], false)
        const { res } = yield* submitOne()
        const { sub } = yield* gradeToTerminal(res.id)
        assert.deepStrictEqual([sub.status, sub.reviewReason], ["needs_review", "illegible"])
      }))

    it.effect("two invalid answers go to the teacher, never a coerced grade (P14)", () =>
      Effect.gen(function*() {
        nextOutcome = new InvalidModelOutput({ message: "bad" })
        const { res } = yield* submitOne()
        const { sub, grades } = yield* gradeToTerminal(res.id)
        assert.deepStrictEqual([sub.status, sub.reviewReason], ["needs_review", "invalid_output"])
        assert.strictEqual(grades.length, 0)
      }))

    it.effect("a non-retryable provider error ends in needs_review via onDead", () =>
      Effect.gen(function*() {
        nextOutcome = new ModelError({ kind: "credits_exhausted", message: "402" })
        const { res } = yield* submitOne()
        const { sub } = yield* gradeToTerminal(res.id)
        assert.deepStrictEqual([sub.status, sub.reviewReason], ["needs_review", "grading_failed"])
      }))
  })
})
