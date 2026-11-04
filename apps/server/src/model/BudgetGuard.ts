import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { AppConfig } from "../AppConfig.ts"
import { ModelError } from "./ModelClient.ts"

/**
 * Refuses model-spending work once the OpenRouter key's remaining credit is
 * at or below BUDGET_FLOOR_USD. Reads GET /key, cached for a minute so
 * a busy worker doesn't double its request count.
 */
export class BudgetGuard extends Context.Service<BudgetGuard, {
  /** Remaining credit in USD, or None if the key has no limit. */
  readonly remaining: Effect.Effect<Option.Option<number>, ModelError>
  /** Fails with kind "budget_guard" if spending `projectedUsd` would cross the floor. */
  readonly check: (projectedUsd: number) => Effect.Effect<void, ModelError>
}>()("autograder/BudgetGuard") {
  static readonly layer = Layer.effect(
    BudgetGuard,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const KeyInfo = Schema.Struct({ data: Schema.Struct({ limit_remaining: Schema.NullOr(Schema.Number) }) })

      const fetchRemaining = Effect.gen(function*() {
        if (Option.isNone(config.model.apiKey)) {
          return yield* new ModelError({ kind: "not_configured", message: "OPENROUTER_API_KEY is not set" })
        }
        const res = yield* http.execute(
          HttpClientRequest.get(`${config.model.baseUrl}/key`).pipe(
            HttpClientRequest.bearerToken(Redacted.value(config.model.apiKey.value))
          )
        ).pipe(
          Effect.flatMap((r) => r.json),
          Effect.flatMap(Schema.decodeUnknownEffect(KeyInfo)),
          Effect.timeout(Duration.seconds(10)),
          Effect.mapError((e) => new ModelError({ kind: "network", message: `budget check failed: ${String(e)}` }))
        )
        return Option.fromNullishOr(res.data.limit_remaining)
      })
      const remaining = yield* Effect.cachedWithTTL(fetchRemaining, Duration.minutes(1))

      const check = (projectedUsd: number) =>
        remaining.pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.void,
            onSome: (left) =>
              left - projectedUsd <= config.model.budgetFloorUsd
                ? Effect.fail(new ModelError({
                  kind: "budget_guard",
                  message: `key has $${left.toFixed(2)} left; floor is $${config.model.budgetFloorUsd}`
                }))
                : Effect.void
          }))
        )

      return BudgetGuard.of({ remaining, check })
    })
  )
}
