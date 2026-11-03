import { Api } from "@autograder/domain"
import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Duration, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter, HttpStaticServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { AppConfig } from "./AppConfig.ts"
import { DbLive } from "./Db.ts"
import { Grader } from "./grading/Grader.ts"
import { makeGradeHandler } from "./grading/GradeJob.ts"
import { RubricGenerator } from "./grading/RubricGenerator.ts"
import { Submissions } from "./grading/Submissions.ts"
import { BudgetGuard } from "./model/BudgetGuard.ts"
import { ModelCallLedger } from "./model/Ledger.ts"
import { OpenRouterModelLive } from "./model/ModelClient.ts"
import { ApiHandlers } from "./http/Handlers.ts"
import { AdminAuthLive } from "./http/AdminAuth.ts"
import { Instance } from "./Instance.ts"
import { CloudLogger } from "./Logging.ts"
import { JobQueue } from "./queue/JobQueue.ts"
import { echoHandler, JobHandlers } from "./worker/JobHandlers.ts"
import { WakeSignal } from "./worker/WakeSignal.ts"
import { WorkerLive } from "./worker/Worker.ts"

/**
 * One process runs everything (D-28): the HTTP API, the built web app, and
 * the grading worker. Cloud Run's --no-cpu-throttling keeps the worker's CPU
 * after a submit request has returned.
 */
const App = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* AppConfig
    const apiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(ApiHandlers), Layer.provide(AdminAuthLive))
    const webRoutes = HttpStaticServer.layer({ root: config.webDist, spa: true })
    const http = HttpRouter.serve(Layer.mergeAll(apiRoutes, webRoutes)).pipe(
      Layer.provide(BunHttpServer.layer({ port: config.port, gracefulShutdownTimeout: Duration.seconds(5) }))
    )
    const worker = WorkerLive.pipe(Layer.provide(HandlersLive))
    yield* Effect.logInfo(`starting version=${config.version} port=${config.port}`)
    return Layer.mergeAll(http, worker)
  })
)

/** Job kinds the worker runs. Grading uses the real model; simulated assignments arrive in Phase 4. */
const HandlersLive = Layer.effect(
  JobHandlers,
  Effect.map(makeGradeHandler, (grade) => new Map([["echo", echoHandler], ["grade", grade]]))
).pipe(Layer.provide(Grader.layer))

const ModelLive = Layer.mergeAll(OpenRouterModelLive, BudgetGuard.layer, ModelCallLedger.layerSql).pipe(
  Layer.provide(FetchHttpClient.layer)
)

const Services = Layer.mergeAll(Submissions.layer, RubricGenerator.layer).pipe(
  Layer.provideMerge(JobQueue.layer),
  Layer.provideMerge(ModelLive),
  Layer.provideMerge(Layer.mergeAll(DbLive, WakeSignal.layer, Instance.layer)),
  Layer.provideMerge(AppConfig.layer)
)

App.pipe(
  Layer.provide(Services),
  Layer.provide(BunServices.layer),
  Layer.provide(CloudLogger),
  Layer.launch,
  BunRuntime.runMain
)
