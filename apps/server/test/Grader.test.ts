import { Rubric, RubricItem } from "@autograder/domain"
import { BunServices } from "@effect/platform-bun"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { Grader } from "../src/grading/Grader.ts"
import { BudgetGuard } from "../src/model/BudgetGuard.ts"
import { type ModelCallRecord, ModelCallLedger } from "../src/model/Ledger.ts"
import { ModelClient, ModelError, type ModelRequest } from "../src/model/ModelClient.ts"
import { SimulatedModel } from "../src/model/SimulatedModel.ts"
import { testConfig } from "./support/TestConfig.ts"

const rubric = new Rubric({
  items: [
    new RubricItem({ id: "c1", label: "Distributes 3", description: "Writes 3x - 6", points: 1 }),
    new RubricItem({ id: "c2", label: "Isolates x", description: "Reaches x - 6 = 5", points: 1 }),
    new RubricItem({ id: "c3", label: "Finds x = 11", description: "Answer x = 11", points: 2 })
  ],
  referenceSolution: "3x - 6 = 2x + 5\nx = 11"
})

const reply = (criteria: Array<[string, string]>, legible = true) =>
  JSON.stringify({
    transcription: "3x - 6 = 2x + 5\nx = 11",
    legible,
    criteria: criteria.map(([id, verdict]) => ({ id, verdict, evidence: "line 1" })),
    confidence: "high"
  })

/** Scripted model: answers in order, recording each request it was sent. */
const scripted = (answers: Array<string>) => {
  const requests: Array<ModelRequest> = []
  const layer = Layer.succeed(ModelClient, ModelClient.of({
    complete: (req) =>
      Effect.sync(() => {
        requests.push(req)
        return { model: req.model, provider: "TestCo", content: answers[requests.length - 1] ?? "{}", inputTokens: 1500, outputTokens: 200, costUsd: 0.0004, latencyMs: 900, httpStatus: 200 }
      })
  }))
  return { layer, requests }
}

const guard = (blocked: boolean) =>
  Layer.succeed(BudgetGuard, BudgetGuard.of({
    remaining: Effect.succeed(Option.some(blocked ? 1 : 40)),
    check: () => blocked ? Effect.fail(new ModelError({ kind: "budget_guard", message: "floor" })) : Effect.void
  }))

const gradeWith = (model: ReturnType<typeof scripted>, blocked = false) =>
  Effect.gen(function*() {
    const calls = yield* Ref.make<ReadonlyArray<ModelCallRecord>>([])
    const result = yield* Effect.gen(function*() {
      const grader = yield* Grader
      return yield* grader.grade({
        problem: { prompt: "Solve 3(x - 2) = 2x + 5", answerKey: "x = 11" },
        rubric,
        imagePng: new Uint8Array([1]),
        purpose: "grade"
      })
    }).pipe(
      Effect.provide(Grader.layer.pipe(Layer.provide([model.layer, SimulatedModel.layer.pipe(Layer.provide(testConfig())), ModelCallLedger.memory(calls), guard(blocked), testConfig(), BunServices.layer]))),
      Effect.result
    )
    return { result, ledger: yield* Ref.get(calls) }
  })

describe("Grader", () => {
  it.effect("totals weighted points in code from the model's verdicts", () =>
    Effect.gen(function*() {
      const model = scripted([reply([["c1", "met"], ["c2", "not_met"], ["c3", "met"]])])
      const { result, ledger } = yield* gradeWith(model)
      expect(result._tag).toBe("Success")
      if (result._tag === "Success") {
        expect(result.success.totalPoints).toBe(3)
        expect(result.success.maxPoints).toBe(4)
        expect(result.success.promptVersion).toBe("grade.v2")
      }
      expect(ledger.map((c) => c.outcome)).toEqual(["ok"])
      // The prompt carries criteria ids and descriptions but never point values (D-11).
      expect(model.requests[0]!.text).toContain("- c3: Answer x = 11")
      expect(model.requests[0]!.text).not.toMatch(/points?/i)
    }))

  it.effect("retries once with the validation error, then succeeds (P14)", () =>
    Effect.gen(function*() {
      const model = scripted([reply([["c1", "met"]]), reply([["c1", "met"], ["c2", "met"], ["c3", "met"]])])
      const { result, ledger } = yield* gradeWith(model)
      expect(result._tag).toBe("Success")
      expect(model.requests[1]!.correction).toContain("missing verdicts for c2, c3")
      expect(ledger.map((c) => c.outcome)).toEqual(["invalid_output", "ok"])
    }))

  it.effect("gives up after a second invalid answer instead of coercing a grade", () =>
    Effect.gen(function*() {
      const { result } = yield* gradeWith(scripted(["not json", reply([["c9", "met"]])]))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(result.failure._tag).toBe("InvalidModelOutput")
    }))

  it.effect("accepts an abstention with no verdicts and scores it zero", () =>
    Effect.gen(function*() {
      const { result } = yield* gradeWith(scripted([reply([], false)]))
      expect(result._tag).toBe("Success")
      if (result._tag === "Success") {
        expect(result.success.output.legible).toBe(false)
        expect(result.success.totalPoints).toBe(0)
      }
    }))

  it.effect("does not call the model when the budget guard refuses", () =>
    Effect.gen(function*() {
      const model = scripted([reply([["c1", "met"], ["c2", "met"], ["c3", "met"]])])
      const { result } = yield* gradeWith(model, true)
      expect(result._tag).toBe("Failure")
      expect(model.requests).toHaveLength(0)
    }))
})
