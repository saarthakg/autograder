import { checkVerdicts, GradeOutput, maxPoints, type Rubric, totalPoints } from "@autograder/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { OpenAiStructuredOutput } from "effect/ai"
import { AppConfig } from "../AppConfig.ts"
import { BudgetGuard } from "../model/BudgetGuard.ts"
import { ModelCallLedger, type ModelCallRecord } from "../model/Ledger.ts"
import { ModelClient, type ModelError, type ModelResponse } from "../model/ModelClient.ts"
import { loadPrompt, type PromptTemplate, render } from "./Prompts.ts"

export const GRADE_PROMPT = "grade.v2"
/** Upper bound for the budget guard; real cheap-tier grades cost ~$0.0005 (PLAN §7). */
const MAX_COST_PER_CALL_USD = 0.02

export interface GradeInput {
  readonly problem: { readonly prompt: string; readonly answerKey: string | null }
  readonly rubric: Rubric
  readonly imagePng: Uint8Array
  readonly model?: string | undefined
  readonly purpose: ModelCallRecord["purpose"]
  readonly simulated?: boolean | undefined
  readonly submissionId?: string | undefined
  readonly runId?: string | undefined
}

export interface GradeResult {
  readonly output: GradeOutput
  /** Per-criterion met/not met, validated against the rubric. */
  readonly met: ReadonlyMap<string, boolean>
  /** Computed here, from rubric weights, never by the model (P13). */
  readonly totalPoints: number
  readonly maxPoints: number
  readonly model: string
  readonly promptVersion: string
  readonly startedAt: Date
  readonly finishedAt: Date
  /** All calls made for this grade, including an invalid first attempt. */
  readonly calls: ReadonlyArray<ModelResponse>
}

/** The model answered twice with output we can't use: the teacher grades it (P14, P9). */
export class InvalidModelOutput extends Schema.TaggedError<InvalidModelOutput>()("InvalidModelOutput", {
  message: Schema.String
}) {}

const structured = OpenAiStructuredOutput.toCodecOpenAI(GradeOutput)
const decodeOutput = Schema.decodeUnknownEffect(structured.codec)

export const formatCriteria = (rubric: Rubric) => rubric.items.map((i) => `- ${i.id}: ${i.description}`).join("\n")

export class Grader extends Context.Service<Grader, {
  readonly grade: (input: GradeInput) => Effect.Effect<GradeResult, InvalidModelOutput | ModelError>
}>()("autograder/Grader") {
  static readonly layer = Layer.effect(
    Grader,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const client = yield* ModelClient
      const ledger = yield* ModelCallLedger
      const guard = yield* BudgetGuard
      const prompt: PromptTemplate = yield* loadPrompt(config.promptsDir, GRADE_PROMPT).pipe(Effect.orDie)

      const grade = Effect.fn("Grader.grade")(function*(input: GradeInput) {
        const model = input.model ?? config.model.gradingModel
        const simulated = input.simulated === true
        const text = render(prompt.user, {
          problem: input.problem.prompt,
          answerKey: input.problem.answerKey ?? "(none given)",
          referenceSolution: input.rubric.referenceSolution,
          criteria: formatCriteria(input.rubric)
        })
        const base = { purpose: input.purpose, model, simulated, submissionId: input.submissionId, runId: input.runId }
        const calls: Array<ModelResponse> = []
        const startedAt = new Date()

        const attempt = (correction: string | undefined) =>
          Effect.gen(function*() {
            if (!simulated) yield* guard.check(MAX_COST_PER_CALL_USD)
            const response = yield* client.complete({
              model,
              system: prompt.system,
              text,
              imagePng: input.imagePng,
              schemaName: "grade",
              jsonSchema: structured.jsonSchema,
              maxTokens: 1500,
              correction
            }).pipe(
              Effect.tapError((e) =>
                ledger.record({ ...base, outcome: e.kind, latencyMs: e.latencyMs ?? 0, httpStatus: e.httpStatus, error: e.message })
              )
            )
            calls.push(response)
            const usage = { latencyMs: response.latencyMs, httpStatus: response.httpStatus, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: response.costUsd }
            const parsed = yield* Effect.try({ try: () => JSON.parse(response.content) as unknown, catch: () => "response is not JSON" }).pipe(
              Effect.flatMap((json) => decodeOutput(json).pipe(Effect.mapError((e) => `response does not match the schema: ${e.message}`))),
              Effect.flatMap((output) => {
                const check = checkVerdicts(input.rubric, output)
                return check._tag === "Valid" ? Effect.succeed({ output, met: check.met }) : Effect.fail(check.reason)
              }),
              Effect.tapError((reason) => ledger.record({ ...base, ...usage, outcome: "invalid_output", error: reason })),
              Effect.mapError((reason) => new InvalidModelOutput({ message: reason }))
            )
            yield* ledger.record({ ...base, ...usage, outcome: "ok" })
            return parsed
          })

        // P14: one retry with the validation error fed back, then give up honestly.
        const { output, met } = yield* attempt(undefined).pipe(
          Effect.catchTag("InvalidModelOutput", (e) =>
            attempt(
              `Your previous answer was rejected: ${e.message}. Return JSON matching the schema, ` +
                `with exactly one verdict for each of these criterion ids: ${input.rubric.items.map((i) => i.id).join(", ")}.`
            ))
        )
        return {
          output,
          met,
          totalPoints: totalPoints(input.rubric, met),
          maxPoints: maxPoints(input.rubric),
          model,
          promptVersion: GRADE_PROMPT,
          startedAt,
          finishedAt: new Date(),
          calls
        } satisfies GradeResult
      })

      return Grader.of({ grade })
    })
  )
}
