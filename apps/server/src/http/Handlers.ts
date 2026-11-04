import { Api, DatabaseUnavailable, Health, Readiness } from "@autograder/domain"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../AppConfig.ts"
import { Instance } from "../Instance.ts"
import { AdminHandlers } from "./AdminHandlers.ts"
import { LoadTestHandlers } from "./LoadTestHandlers.ts"
import { ProductHandlers } from "./ProductHandlers.ts"

export const SystemHandlers = HttpApiBuilder.group(
  Api,
  "system",
  Effect.fn(function*(handlers) {
    const config = yield* AppConfig
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    return handlers.handleAll({
      health: () =>
        Effect.sync(() =>
          new Health({
            status: "ok",
            version: config.version,
            instanceId: instance.id,
            uptimeSec: Math.round((Date.now() - instance.startedAt) / 1000)
          })
        ),
      ready: () =>
        Effect.gen(function*() {
          const started = Date.now()
          yield* sql`SELECT 1`
          return new Readiness({ db: "ok", dbLatencyMs: Date.now() - started })
        }).pipe(Effect.catch((e) => Effect.fail(new DatabaseUnavailable({ message: e.message }))))
    })
  })
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, AdminHandlers, LoadTestHandlers, ProductHandlers)
