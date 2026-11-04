import { checkVerdicts, GradeOutput, Rubric, RubricItem } from "@autograder/domain"
import { BunServices } from "@effect/platform-bun"
import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Option, Ref, Schema } from "effect"
import { Grader } from "../src/grading/Grader.ts"
import { BudgetGuard } from "../src/model/BudgetGuard.ts"
import { type ModelCallRecord, ModelCallLedger } from "../src/model/Ledger.ts"
import { ModelClient, ModelError, type ModelRequest } from "../src/model/ModelClient.ts"
import { make, type SimulationConfig, SimulatedModel } from "../src/model/SimulatedModel.ts"
import { testConfig } from "./support/TestConfig.ts"

const rubric = new Rubric({
  items: [
    new RubricItem({ id: "c1", label: "Distributes 3", description: "Writes 3x - 6", points: 1 }),
    new RubricItem({ id: "c2", label: "Isolates x", description: "Reaches x - 6 = 5", points: 1 }),
    new RubricItem({ id: "c3", label: "Finds x = 11", description: "Answer x = 11", points: 2 })
  ],
  referenceSolution: "x = 11"
})
const healthy: SimulationConfig = { latencyMedianMs: 1, latencySigma: 0, rate429: 0, rate5xx: 0, rateInvalid: 0, maxConcurrent: 10 }
const request = (seed: string): ModelRequest => ({
  model: "unused", system: "s", text: "t", schemaName: "grade", jsonSchema: {}, maxTokens: 10,
  simulate: { criterionIds: ["c1", "c2", "c3"], seed }
})
const decode = Schema.decodeUnknownSync(GradeOutput)

describe("SimulatedModel (D-28)", () => {
  it.live("returns schema-valid output over the real criterion ids, deterministic per submission", () =>
    Effect.gen(function*() {
      const sim = make(healthy)
      const a = yield* sim.complete(request("sub-1"))
      const b = yield* sim.complete(request("sub-1"))
      const output = decode(JSON.parse(a.content))
      expect(checkVerdicts(rubric, output)._tag).toBe("Valid")
      expect(a.content).toBe(b.content)
      expect(a.model).toBe("simulated/grader")
    }))

  it.live("injects 429 with Retry-After and 5xx at the configured rates", () =>
    Effect.gen(function*() {
      const limited = yield* make({ ...healthy, rate429: 1 }).complete(request("x")).pipe(Effect.flip)
      expect(limited.kind).toBe("rate_limited")
      expect(limited.retryAfter).toBeDefined()
      const failed = yield* make({ ...healthy, rate5xx: 1 }).complete(request("x")).pipe(Effect.flip)
      expect([failed.kind, failed.retryable]).toEqual(["provider_error", true])
    }))

  it.live("answers 429 above its concurrency cap, like a provider's rate limit", () =>
    Effect.gen(function*() {
      const sim = make({ ...healthy, latencyMedianMs: 50, maxConcurrent: 2 })
      const results = yield* Effect.forEach(["a", "b", "c"], (s) => sim.complete(request(s)).pipe(Effect.result), { concurrency: 3 })
      expect(results.filter((r) => r._tag === "Failure")).toHaveLength(1)
      expect(sim.inFlight()).toBe(0)
    }))

  it.live("the Grader sends simulated work to the simulator, never the real client, and skips the budget guard", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<ReadonlyArray<ModelCallRecord>>([])
      const realCalls: Array<ModelRequest> = []
      const real = Layer.succeed(ModelClient, ModelClient.of({ complete: (r) => Effect.sync(() => { realCalls.push(r) }).pipe(Effect.andThen(Effect.die("real model called"))) }))
      const blockedGuard = Layer.succeed(BudgetGuard, BudgetGuard.of({
        remaining: Effect.succeed(Option.some(0)),
        check: () => Effect.fail(new ModelError({ kind: "budget_guard", message: "floor" }))
      }))
      const result = yield* Effect.gen(function*() {
        return yield* (yield* Grader).grade({
          problem: { prompt: "p", answerKey: null }, rubric, imagePng: new Uint8Array([1]), purpose: "grade", simulated: true, submissionId: "sub-9"
        })
      }).pipe(Effect.provide(Grader.layer.pipe(Layer.provide([
        real, SimulatedModel.layer.pipe(Layer.provide(testConfig())), ModelCallLedger.memory(calls), blockedGuard, testConfig(), BunServices.layer
      ]))))
      expect(realCalls).toHaveLength(0)
      expect(result.model).toBe("simulated/grader")
      expect((yield* Ref.get(calls)).every((c) => c.simulated)).toBe(true)
    }), { timeout: Duration.toMillis(Duration.seconds(5)) })
})
