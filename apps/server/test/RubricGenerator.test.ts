import { BunServices } from "@effect/platform-bun"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { RubricGenerator } from "../src/grading/RubricGenerator.ts"
import { BudgetGuard } from "../src/model/BudgetGuard.ts"
import { type ModelCallRecord, ModelCallLedger } from "../src/model/Ledger.ts"
import { ModelClient, type ModelRequest } from "../src/model/ModelClient.ts"
import { testConfig } from "./support/TestConfig.ts"

const draft = (points: Array<number>) =>
  JSON.stringify({
    items: points.map((p, i) => ({ id: `c${i + 1}`, label: `Step ${i + 1}`, description: `Does step ${i + 1}`, points: p })),
    referenceSolution: "-2x > 8\nx < -4"
  })

const run = (answers: Array<string>) =>
  Effect.gen(function*() {
    const requests: Array<ModelRequest> = []
    const calls = yield* Ref.make<ReadonlyArray<ModelCallRecord>>([])
    const model = Layer.succeed(ModelClient, ModelClient.of({
      complete: (req) => Effect.sync(() => {
        requests.push(req)
        return { content: answers[requests.length - 1] ?? "{}", inputTokens: 300, outputTokens: 250, costUsd: 0.002, latencyMs: 1500, httpStatus: 200 }
      })
    }))
    const guard = Layer.succeed(BudgetGuard, BudgetGuard.of({ remaining: Effect.succeed(Option.none()), check: () => Effect.void }))
    const result = yield* Effect.gen(function*() {
      return yield* (yield* RubricGenerator).generate({ prompt: "Solve -2x + 3 > 11", answerKey: "x < -4", maxPoints: 3 })
    }).pipe(
      Effect.provide(RubricGenerator.layer.pipe(Layer.provide([model, guard, ModelCallLedger.memory(calls), testConfig(), BunServices.layer]))),
      Effect.result
    )
    return { result, requests }
  })

describe("RubricGenerator", () => {
  it.effect("returns a rubric whose points sum to the problem max", () =>
    Effect.gen(function*() {
      const { result, requests } = yield* run([draft([1, 1, 1])])
      expect(result._tag).toBe("Success")
      expect(requests[0]!.system).toContain("add up to exactly 3")
    }))

  it.effect("retries once when points don't add up, never rescaling them", () =>
    Effect.gen(function*() {
      const { result, requests } = yield* run([draft([2, 2]), draft([2, 1])])
      expect(result._tag).toBe("Success")
      expect(requests[1]!.correction).toContain("sum to 4, but the problem is worth 3")
    }))

  it.effect("fails after a second bad draft so the teacher gets a template", () =>
    Effect.gen(function*() {
      const { result } = yield* run([draft([2, 2]), draft([5])])
      expect(result._tag).toBe("Failure")
    }))
})
