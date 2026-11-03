import { AdminAuth, Api, SubmitRequest } from "@autograder/domain"
import { BunServices } from "@effect/platform-bun"
import { assert, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { ApiHandlers } from "../src/http/Handlers.ts"
import { RubricGenerator } from "../src/grading/RubricGenerator.ts"
import { Submissions } from "../src/grading/Submissions.ts"
import { AdminAuthLive } from "../src/http/AdminAuth.ts"
import { Instance } from "../src/Instance.ts"
import { JobQueue } from "../src/queue/JobQueue.ts"
import { WakeSignal } from "../src/worker/WakeSignal.ts"
import { testConfig } from "./support/TestConfig.ts"
import { PNG, resetDb, STROKES } from "./support/Seed.ts"
import { TestDb, truncateJobs } from "./support/TestDb.ts"

const withToken = (token: string | undefined) =>
  HttpApiMiddleware.layerClient(AdminAuth, ({ next, request }) =>
    next(token === undefined ? request : HttpClientRequest.bearerToken(request, token)))

const NoRubrics = Layer.succeed(RubricGenerator, RubricGenerator.of({ generate: () => Effect.die("not used") }))

const Handlers = ApiHandlers.pipe(
  Layer.provideMerge(AdminAuthLive),
  Layer.provide(Layer.mergeAll(Submissions.layer, NoRubrics).pipe(
    Layer.provideMerge(JobQueue.layer),
    Layer.provideMerge(Layer.mergeAll(WakeSignal.layer, Instance.layer, BunServices.layer))
  )),
  Layer.provide(testConfig()),
  Layer.provideMerge(TestDb)
)

const makeClient = HttpApiTest.groups(Api, ["system", "admin"])

layer(Layer.mergeAll(Handlers, HttpServer.layerServices), { excludeTestServices: true })("HTTP API", (it) => {
  it.effect("health answers without touching the database", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const health = yield* client.health()
      assert.strictEqual(health.status, "ok")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("ready pings the database", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const ready = yield* client.ready()
      assert.strictEqual(ready.db, "ok")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("admin endpoints reject a missing or wrong token", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const noToken = yield* client.admin.enqueueEcho({ payload: {} }).pipe(Effect.flip, Effect.provide(withToken(undefined)))
      assert.strictEqual(noToken._tag, "Unauthorized")
      const wrong = yield* client.admin.enqueueEcho({ payload: {} }).pipe(Effect.flip, Effect.provide(withToken("nope")))
      assert.strictEqual(wrong._tag, "Unauthorized")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("enqueues an echo job tagged with its run id", () =>
    Effect.gen(function*() {
      yield* truncateJobs
      const client = yield* makeClient
      const job = yield* client.admin.enqueueEcho({ payload: { runId: "run-123" } })
      assert.strictEqual(job.status, "queued")
      const fetched = yield* client.admin.getJob({ params: { id: job.id } })
      assert.strictEqual(fetched.id, job.id)
    }).pipe(Effect.provide(withToken("test-token"))))

  it.effect("creates a demo class, accepts a submission and reads it back", () =>
    Effect.gen(function*() {
      yield* resetDb
      const client = yield* makeClient
      const demo = yield* client.admin.createDemoClass()
      assert.strictEqual(demo.problems.length, 3)
      const accepted = yield* client.admin.submit({
        payload: new SubmitRequest({ studentId: demo.studentId, problemId: demo.problems[0]!.id, idempotencyKey: "http-test-key", strokes: STROKES, imagePng: PNG })
      })
      assert.strictEqual(accepted.status, "queued")
      const view = yield* client.admin.getSubmission({ params: { id: accepted.id } })
      assert.strictEqual(view.status, "queued")
      assert.isNull(view.grade)
    }).pipe(Effect.provide(withToken("test-token"))))
})
