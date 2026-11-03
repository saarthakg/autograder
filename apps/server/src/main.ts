import { Api } from "@autograder/domain"
import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Duration, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter, HttpStaticServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { AppConfig } from "./AppConfig.ts"
import { DbLive } from "./Db.ts"
import { ApiHandlers } from "./http/Handlers.ts"
import { InternalAuthLive } from "./http/InternalAuth.ts"
import { JobWaker } from "./http/JobWaker.ts"
import { Instance } from "./Instance.ts"
import { CloudLogger } from "./Logging.ts"
import { JobQueue } from "./queue/JobQueue.ts"
import { JobHandlers } from "./worker/JobHandlers.ts"
import { WakeSignal } from "./worker/WakeSignal.ts"
import { WorkerLive } from "./worker/Worker.ts"

/**
 * One image, three roles (D-27):
 *   api    — HTTP API + built web app (request-billed Cloud Run service)
 *   worker — grading worker + the same API, whose /internal/wake it needs
 *   all    — both, for local dev
 */
const App = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* AppConfig

    const apiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(ApiHandlers), Layer.provide(InternalAuthLive))
    const webRoutes = config.role === "worker"
      ? Layer.empty
      : HttpStaticServer.layer({ root: config.webDist, spa: true })
    const http = HttpRouter.serve(Layer.mergeAll(apiRoutes, webRoutes)).pipe(
      Layer.provide(BunHttpServer.layer({ port: config.port, gracefulShutdownTimeout: Duration.seconds(5) }))
    )
    const worker = config.role === "api" ? Layer.empty : WorkerLive.pipe(Layer.provide(JobHandlers.layer))

    yield* Effect.logInfo(`starting role=${config.role} version=${config.version} port=${config.port}`)
    return Layer.mergeAll(http, worker)
  })
)

const Services = Layer.mergeAll(JobQueue.layer, JobWaker.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(DbLive, WakeSignal.layer, Instance.layer, FetchHttpClient.layer)),
  Layer.provideMerge(AppConfig.layer)
)

App.pipe(
  Layer.provide(Services),
  Layer.provide(BunServices.layer),
  Layer.provide(CloudLogger),
  Layer.launch,
  BunRuntime.runMain
)
