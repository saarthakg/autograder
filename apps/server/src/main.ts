import { Api } from "@autograder/domain"
import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Duration, Effect, Layer } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { AppConfig } from "./AppConfig.ts"
import { DbLive } from "./Db.ts"
import { ApiHandlers } from "./http/Handlers.ts"
import { AdminAuthLive } from "./http/AdminAuth.ts"
import { Instance } from "./Instance.ts"
import { CloudLogger } from "./Logging.ts"
import { JobQueue } from "./queue/JobQueue.ts"
import { JobHandlers } from "./worker/JobHandlers.ts"
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
    const worker = WorkerLive.pipe(Layer.provide(JobHandlers.layer))
    yield* Effect.logInfo(`starting version=${config.version} port=${config.port}`)
    return Layer.mergeAll(http, worker)
  })
)

const Services = JobQueue.layer.pipe(
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
