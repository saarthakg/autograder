import { Effect } from "effect"
import { SqlError } from "effect/sql"

/**
 * Database errors at the HTTP edge are unexpected: they become defects,
 * which the HTTP layer logs and answers with a 500, instead of leaking into
 * every endpoint's typed error list.
 */
export const sqlDefect = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, SqlError.SqlError>, R> =>
  self.pipe(
    Effect.catch((e) => (e instanceof SqlError.SqlError ? Effect.die(e) : Effect.fail(e as Exclude<E, SqlError.SqlError>)))
  )
