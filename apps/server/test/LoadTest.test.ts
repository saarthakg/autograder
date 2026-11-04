import { Api } from "@autograder/domain"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { HttpApiTest } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { PNG, resetDb, STROKES } from "./support/Seed.ts"
import { TestApp, withTokens } from "./support/TestApp.ts"

const makeClient = HttpApiTest.groups(Api, ["loadtest", "public", "student", "teacher"])

layer(TestApp, { excludeTestServices: true })("load-test operator endpoints", (it) => {
  it.effect("a run's classes behave like real ones, analysis reads the server clock, and cleanup removes everything", () =>
    Effect.gen(function*() {
      yield* resetDb
      const sql = yield* SqlClient.SqlClient
      const admin = yield* makeClient.pipe(Effect.provide(withTokens({ admin: "test-token" })))
      const anon = yield* makeClient.pipe(Effect.provide(withTokens()))

      const run = yield* admin.loadtest.createClasses({ payload: { runId: "lt-test-1", classes: 2, problems: 4, simulated: true } })
      assert.strictEqual(run.classes.length, 2)
      const teacher = yield* makeClient.pipe(Effect.provide(withTokens({ teacher: run.teacherSecret })))
      assert.strictEqual((yield* teacher.teacher.listAssignments()).length, 2)

      // A student joins through the public API, exactly like a browser.
      const joined = yield* anon.public.join({ payload: { classCode: run.classes[0]!.classCode, displayName: "Sim 1" } })
      const student = yield* makeClient.pipe(Effect.provide(withTokens({ student: joined.token })))
      const home = yield* student.student.home()
      assert.strictEqual(home.problems.length, 4)
      const accepted = yield* student.student.submit({ payload: { problemId: home.problems[0]!.id, idempotencyKey: "lt-key-0001", strokes: STROKES, imagePng: PNG } })

      // The submission and its job inherit the run_id.
      const [tagged] = yield* sql<{ runId: string; jobRunId: string }>`
        SELECT s.run_id AS "runId", j.run_id AS "jobRunId" FROM submission s JOIN job j ON j.dedupe_key = 'grade:' || s.id WHERE s.id = ${accepted.id}`
      assert.deepStrictEqual([tagged!.runId, tagged!.jobRunId], ["lt-test-1", "lt-test-1"])
      yield* sql`UPDATE submission SET status = 'graded', graded_at = accepted_at + interval '4 seconds' WHERE id = ${accepted.id}`

      const missingId = "00000000-0000-0000-0000-000000000000"
      const analysis = yield* admin.loadtest.analyze({ params: { runId: "lt-test-1" }, payload: { acceptedIds: [accepted.id, missingId] } })
      assert.strictEqual(analysis.submissions, 1)
      assert.deepStrictEqual(analysis.missing, [missingId]) // the lost-submission check catches an acknowledged id with no row
      assert.strictEqual(analysis.timeToGradeSec.p50, 4)
      assert.strictEqual(analysis.byStatus["graded"], 1)

      const metrics = yield* admin.loadtest.metrics()
      assert.isAtLeast(metrics.queued + metrics.running, 1)

      const deleted = yield* admin.loadtest.deleteRun({ params: { runId: "lt-test-1" } })
      assert.deepStrictEqual([deleted.assignments, deleted.teachers, deleted.jobs], [2, 1, 1])
      const after = yield* admin.loadtest.analyze({ params: { runId: "lt-test-1" }, payload: { acceptedIds: [] } })
      assert.strictEqual(after.submissions, 0)
      const [left] = yield* sql<{ n: number }>`SELECT count(*)::int AS n FROM student`
      assert.strictEqual(left!.n, 0)
    }))

  it.effect("load-test endpoints need the admin token", () =>
    Effect.gen(function*() {
      const anon = yield* makeClient.pipe(Effect.provide(withTokens()))
      const err = yield* anon.loadtest.metrics().pipe(Effect.flip)
      assert.strictEqual(err._tag, "Unauthorized")
      // Without ENABLE_CHAOS=1 the crash endpoint doesn't exist, even for the operator.
      const admin = yield* makeClient.pipe(Effect.provide(withTokens({ admin: "test-token" })))
      const crash = yield* admin.loadtest.crash().pipe(Effect.flip)
      assert.strictEqual(crash._tag, "ChaosDisabled")
    }))
})
