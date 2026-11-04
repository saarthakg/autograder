import { AdminAuth, StudentAuth, TeacherAuth } from "@autograder/domain"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { RubricGenerator } from "../../src/grading/RubricGenerator.ts"
import { Submissions } from "../../src/grading/Submissions.ts"
import { AdminAuthLive } from "../../src/http/AdminAuth.ts"
import { ModelError } from "../../src/model/ModelClient.ts"
import { ApiHandlers } from "../../src/http/Handlers.ts"
import { StudentAuthLive, TeacherAuthLive } from "../../src/http/ProductAuth.ts"
import { Instance } from "../../src/Instance.ts"
import { Students } from "../../src/product/Students.ts"
import { Teachers } from "../../src/product/Teachers.ts"
import { JobQueue } from "../../src/queue/JobQueue.ts"
import { WakeSignal } from "../../src/worker/WakeSignal.ts"
import { testConfig } from "./TestConfig.ts"
import { SimulatedModel } from "../../src/model/SimulatedModel.ts"
import { TestDb } from "./TestDb.ts"

/** Rubric drafting always fails in tests, like a provider outage, exercising the template fallback (D-08). */
const NoRubrics = Layer.succeed(RubricGenerator, RubricGenerator.of({
  generate: () => Effect.fail(new ModelError({ kind: "provider_error", message: "no model in tests" }))
}))

/** The whole HTTP API over real Postgres, no network: for HttpApiTest clients. */
export const TestApp = ApiHandlers.pipe(
  Layer.provideMerge(Layer.mergeAll(AdminAuthLive, TeacherAuthLive, StudentAuthLive)),
  Layer.provideMerge(Layer.mergeAll(Teachers.layer, Students.layer)),
  Layer.provideMerge(Layer.mergeAll(Submissions.layer, NoRubrics)),
  Layer.provideMerge(JobQueue.layer),
  Layer.provideMerge(Layer.mergeAll(WakeSignal.layer, Instance.layer, SimulatedModel.layer, BunServices.layer)),
  Layer.provide(testConfig()),
  Layer.provideMerge(TestDb),
  Layer.provideMerge(HttpServer.layerServices)
)

const auth = (request: HttpClientRequest.HttpClientRequest, token: string | undefined) =>
  token === undefined ? request : HttpClientRequest.bearerToken(request, token)

/** Client-side middleware for every protected group; tokens are optional per role. */
export const withTokens = (tokens: { admin?: string; teacher?: string; student?: string } = {}) =>
  Layer.mergeAll(
    HttpApiMiddleware.layerClient(AdminAuth, ({ next, request }) => next(auth(request, tokens.admin))),
    HttpApiMiddleware.layerClient(TeacherAuth, ({ next, request }) => next(auth(request, tokens.teacher))),
    HttpApiMiddleware.layerClient(StudentAuth, ({ next, request }) => next(auth(request, tokens.student)))
  )
