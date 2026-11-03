import { Rubric, rubricProblems } from "@autograder/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { OpenAiStructuredOutput } from "effect/ai"
import { AppConfig } from "../AppConfig.ts"
import { BudgetGuard } from "../model/BudgetGuard.ts"
import { ModelCallLedger } from "../model/Ledger.ts"
import { ModelClient, type ModelError } from "../model/ModelClient.ts"
import { InvalidModelOutput } from "./Grader.ts"
import { loadPrompt, render } from "./Prompts.ts"

export const RUBRIC_PROMPT = "rubric.v1"

export interface RubricRequest {
  readonly prompt: string
  readonly answerKey: string | null
  readonly maxPoints: number
}

const structured = OpenAiStructuredOutput.toCodecOpenAI(Rubric)
const decodeRubric = Schema.decodeUnknownEffect(structured.codec)

/**
 * Drafts an editable rubric when a teacher saves a problem (P3, D-08). The
 * draft must pass the same validation as a teacher's edit; if points don't
 * add up after one corrective retry, the caller falls back to a template.
 * Code never rescales points to make them fit (P14).
 */
export class RubricGenerator extends Context.Service<RubricGenerator, {
  readonly generate: (request: RubricRequest) => Effect.Effect<
    { readonly rubric: Rubric; readonly model: string; readonly promptVersion: string },
    InvalidModelOutput | ModelError
  >
}>()("autograder/RubricGenerator") {
  static readonly layer = Layer.effect(
    RubricGenerator,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const client = yield* ModelClient
      const ledger = yield* ModelCallLedger
      const guard = yield* BudgetGuard
      const prompt = yield* loadPrompt(config.promptsDir, RUBRIC_PROMPT).pipe(Effect.orDie)

      const generate = Effect.fn("RubricGenerator.generate")(function*(request: RubricRequest) {
        const model = config.model.rubricModel
        const vars = { problem: request.prompt, answerKey: request.answerKey ?? "(none given)", maxPoints: String(request.maxPoints) }
        const system = render(prompt.system, { maxPoints: vars.maxPoints })
        const text = render(prompt.user, vars)

        const attempt = (correction: string | undefined) =>
          Effect.gen(function*() {
            yield* guard.check(0.02)
            const res = yield* client.complete({ model, system, text, schemaName: "rubric", jsonSchema: structured.jsonSchema, maxTokens: 1500, correction }).pipe(
              Effect.tapError((e) => ledger.record({ purpose: "rubric", model, simulated: false, outcome: e.kind, latencyMs: e.latencyMs ?? 0, error: e.message }))
            )
            const usage = { purpose: "rubric" as const, model, simulated: false, latencyMs: res.latencyMs, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd }
            return yield* Effect.try({ try: () => JSON.parse(res.content) as unknown, catch: () => "response is not JSON" }).pipe(
              Effect.flatMap((json) => decodeRubric(json).pipe(Effect.mapError((e) => `response does not match the schema: ${e.message}`))),
              Effect.flatMap((rubric) => {
                const problems = rubricProblems(rubric, request.maxPoints)
                return problems.length === 0 ? Effect.succeed(rubric) : Effect.fail(problems.join("; "))
              }),
              Effect.tap(() => ledger.record({ ...usage, outcome: "ok" })),
              Effect.tapError((reason) => ledger.record({ ...usage, outcome: "invalid_output", error: reason })),
              Effect.mapError((reason) => new InvalidModelOutput({ message: reason }))
            )
          })

        const rubric = yield* attempt(undefined).pipe(
          Effect.catchTag("InvalidModelOutput", (e) =>
            attempt(`Your previous rubric was rejected: ${e.message}. Fix it and return the full rubric again.`))
        )
        return { rubric, model, promptVersion: RUBRIC_PROMPT }
      })

      return RubricGenerator.of({ generate })
    })
  )
}
