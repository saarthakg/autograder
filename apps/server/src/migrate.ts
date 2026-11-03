import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Effect } from "effect"
import { fileURLToPath } from "node:url"
import { directDbLayer } from "./Db.ts"
import { runMigrations } from "./Migrations.ts"

// Usage: bun run migrate  (reads DATABASE_URL_DIRECT; pass MIGRATE_ENV=loadtest
// to use LOADTEST_DATABASE_URL_DIRECT instead).
const program = Effect.gen(function*() {
  const target = yield* Config.Literals(["prod", "loadtest"], "MIGRATE_ENV").pipe(Config.withDefault("prod"))
  const url = yield* Config.Redacted(target === "loadtest" ? "LOADTEST_DATABASE_URL_DIRECT" : "DATABASE_URL_DIRECT")
  const applied = yield* runMigrations(fileURLToPath(new URL("../migrations", import.meta.url))).pipe(
    Effect.provide(directDbLayer(url))
  )
  yield* Effect.logInfo(
    applied.length === 0 ? `No pending migrations (${target})` : `Applied ${applied.map(([id, name]) => `${id}_${name}`).join(", ")} (${target})`
  )
})

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
