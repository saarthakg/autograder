import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { BudgetGuard } from "../src/model/BudgetGuard.ts"
import { testConfig } from "./support/TestConfig.ts"

const keyEndpoint = (limitRemaining: number | null) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: { limit_remaining: limitRemaining } })))
    )
  )

const check = (remaining: number | null, projected: number) =>
  Effect.gen(function*() {
    const guard = yield* BudgetGuard
    return yield* guard.check(projected).pipe(Effect.result)
  }).pipe(Effect.provide(BudgetGuard.layer.pipe(Layer.provide([keyEndpoint(remaining), testConfig()]))))

describe("BudgetGuard (floor $5)", () => {
  it.effect("allows spend that stays above the floor", () =>
    Effect.gen(function*() {
      expect((yield* check(40, 1))._tag).toBe("Success")
    }))
  it.effect("refuses spend that would cross the floor", () =>
    Effect.gen(function*() {
      const r = yield* check(5.5, 1)
      expect(r._tag).toBe("Failure")
      if (r._tag === "Failure") expect(r.failure.kind).toBe("budget_guard")
    }))
  it.effect("allows anything when the key has no limit", () =>
    Effect.gen(function*() {
      expect((yield* check(null, 100))._tag).toBe("Success")
    }))
})
