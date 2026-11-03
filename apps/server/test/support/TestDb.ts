import { BunServices } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { fileURLToPath } from "node:url"
import { runMigrations } from "../../src/Migrations.ts"

/**
 * Real Postgres for queue tests: SKIP LOCKED and lease semantics can't be
 * mocked honestly (D-25). Uses a separate database from dev data.
 */
const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url))

export const TestPg = Layer.unwrap(
  Effect.gen(function*() {
    // Default matches docker-compose.yml; CI sets TEST_DATABASE_URL explicitly.
    const url = yield* Config.String("TEST_DATABASE_URL").pipe(
      Config.withDefault("postgres://postgres:postgres@localhost:5432/autograder_test")
    )
    return PgClient.layer({ url: Redacted.make(url), maxConnections: 20 })
  })
)

const Migrated = Layer.effectDiscard(
  runMigrations(migrationsDir).pipe(Effect.provide(BunServices.layer))
)

export const TestDb = Migrated.pipe(Layer.provideMerge(TestPg))

export const truncateJobs = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`TRUNCATE job`
})
