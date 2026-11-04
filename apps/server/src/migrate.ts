import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Effect } from "effect"
import { fileURLToPath } from "node:url"
import { directDbLayer } from "./Db.ts"
import { runMigrations } from "./Migrations.ts"

// Usage: bun run migrate (reads DATABASE_URL_DIRECT from the repo's .env).
const program = Effect.gen(function*() {
  const url = yield* Config.Redacted("DATABASE_URL_DIRECT")
  const applied = yield* runMigrations(fileURLToPath(new URL("../migrations", import.meta.url))).pipe(
    Effect.provide(directDbLayer(url))
  )
  yield* Effect.logInfo(
    applied.length === 0 ? "No pending migrations" : `Applied ${applied.map(([id, name]) => `${id}_${name}`).join(", ")}`
  )
})

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
