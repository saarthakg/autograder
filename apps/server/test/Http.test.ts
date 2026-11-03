import { Api, InternalAuth } from "@autograder/domain"
import { assert, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { ApiHandlers } from "../src/http/Handlers.ts"
import { InternalAuthLive } from "../src/http/InternalAuth.ts"
import { JobWaker } from "../src/http/JobWaker.ts"
import { Instance } from "../src/Instance.ts"
import { JobQueue } from "../src/queue/JobQueue.ts"
import { WakeSignal } from "../src/worker/WakeSignal.ts"
import { testConfig } from "./support/TestConfig.ts"
import { TestDb, truncateJobs } from "./support/TestDb.ts"

const withToken = (token: string | undefined) =>
  HttpApiMiddleware.layerClient(InternalAuth, ({ next, request }) =>
    next(token === undefined ? request : HttpClientRequest.bearerToken(request, token)))

const Handlers = ApiHandlers.pipe(
  Layer.provideMerge(InternalAuthLive),
  Layer.provide(Layer.mergeAll(JobQueue.layer, JobWaker.layer).pipe(
    // FetchHttpClient is never called here (no wake URL in tests); JobWaker just requires one.
    Layer.provideMerge(Layer.mergeAll(WakeSignal.layer, Instance.layer, FetchHttpClient.layer))
  )),
  Layer.provide(testConfig()),
  Layer.provideMerge(TestDb)
)

const makeClient = HttpApiTest.groups(Api, ["system", "internal"])

layer(Layer.mergeAll(Handlers, HttpServer.layerServices), { excludeTestServices: true })("HTTP API", (it) => {
  it.effect("health answers without touching the database", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const health = yield* client.health()
      assert.strictEqual(health.status, "ok")
      assert.strictEqual(health.role, "all")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("ready pings the database", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const ready = yield* client.ready()
      assert.strictEqual(ready.db, "ok")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("internal endpoints reject a missing or wrong token", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const noToken = yield* client.internal.enqueueEcho({ payload: {} }).pipe(Effect.flip, Effect.provide(withToken(undefined)))
      assert.strictEqual(noToken._tag, "Unauthorized")
      const wrong = yield* client.internal.enqueueEcho({ payload: {} }).pipe(Effect.flip, Effect.provide(withToken("nope")))
      assert.strictEqual(wrong._tag, "Unauthorized")
    }).pipe(Effect.provide(withToken(undefined))))

  it.effect("enqueues an echo job tagged with its run id", () =>
    Effect.gen(function*() {
      yield* truncateJobs
      const client = yield* makeClient
      const job = yield* client.internal.enqueueEcho({ payload: { runId: "run-123" } })
      assert.strictEqual(job.status, "queued")
      const fetched = yield* client.internal.getJob({ params: { id: job.id } })
      assert.strictEqual(fetched.id, job.id)
    }).pipe(Effect.provide(withToken("test-token"))))
})
