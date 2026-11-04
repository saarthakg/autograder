import { PgMigrator } from "@effect/sql-pg"
import { Effect, FileSystem, Path } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/**
 * Splits a migration file into statements. `@effect/sql-pg` speaks only the
 * extended query protocol, which rejects multi-statement strings, so each
 * statement runs separately (still inside the migrator's one transaction).
 * A statement ends at a `;` that closes a line, outside `$$`-quoted bodies.
 */
export const splitStatements = (text: string): ReadonlyArray<string> => {
  const statements: Array<string> = []
  let current: Array<string> = []
  let inDollarQuote = false
  for (const line of text.split("\n")) {
    const withoutComment = line.replace(/--.*$/, "")
    if (!inDollarQuote && current.length === 0 && withoutComment.trim() === "") continue
    current.push(line)
    if ((withoutComment.match(/\$\$/g)?.length ?? 0) % 2 === 1) inDollarQuote = !inDollarQuote
    if (!inDollarQuote && /;\s*$/.test(withoutComment)) {
      statements.push(current.join("\n").trim())
      current = []
    }
  }
  const rest = current.join("\n").replace(/--.*$/gm, "").trim()
  if (rest !== "") statements.push(current.join("\n").trim())
  return statements
}

/**
 * Loads `migrations/NNNN_name.sql` files into Effect's migrator, which handles
 * ordering, locking and the migrations table. Each file runs in the
 * migrator's transaction.
 */
const sqlFileLoader = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const files = (yield* fs.readDirectory(directory)).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort()
    const record: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {}
    for (const file of files) {
      const text = yield* fs.readFileString(path.join(directory, file))
      record[file.replace(/\.sql$/, "")] = Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        for (const statement of splitStatements(text)) {
          yield* sql.unsafe(statement)
        }
      })
    }
    return yield* Migrator.fromRecord(record)
  }).pipe(
    Effect.mapError((cause) => new Migrator.MigrationError({ kind: "Failed", cause, message: "Failed to load SQL migrations" }))
  )

export const runMigrations = (directory: string) => PgMigrator.run({ loader: sqlFileLoader(directory) })
