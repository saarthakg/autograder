import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { AppConfig } from "./AppConfig.ts"

/**
 * Postgres client for the app. In prod this is Neon's *pooled* URL (PgBouncer,
 * transaction mode), so every query must stand alone or run inside one
 * transaction: no session state, LISTEN, or session advisory locks (D-20 A4).
 */
export const DbLive = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* AppConfig
    return PgClient.layer({
      url: config.databaseUrl,
      maxConnections: config.dbPoolMax,
      applicationName: "autograder"
    })
  })
)

/** Client for migrations, which run over the *direct* URL (D-20 A4). */
export const directDbLayer = (url: Redacted.Redacted) => PgClient.layer({ url, maxConnections: 1 })
