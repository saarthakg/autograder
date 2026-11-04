import { Context, Effect, Layer, Ref } from "effect"
import { SqlClient } from "effect/sql"

export interface ModelCallRecord {
  readonly purpose: "grade" | "rubric" | "eval" | "canary"
  readonly model: string
  readonly provider?: string | null | undefined
  readonly simulated: boolean
  /** "ok", "invalid_output", or a ModelErrorKind. */
  readonly outcome: string
  readonly latencyMs: number
  readonly httpStatus?: number | undefined
  readonly inputTokens?: number | null | undefined
  readonly outputTokens?: number | null | undefined
  readonly costUsd?: number | null | undefined
  readonly error?: string | undefined
  readonly submissionId?: string | undefined
  readonly runId?: string | undefined
}

/**
 * Every model call, success or failure: the source for cost per grade,
 * error and 429 rates, and spend. Recording never fails the caller; a lost
 * ledger row is logged, not allowed to lose a grade.
 */
export class ModelCallLedger extends Context.Service<ModelCallLedger, {
  readonly record: (call: ModelCallRecord) => Effect.Effect<void>
}>()("autograder/ModelCallLedger") {
  static readonly layerSql = Layer.effect(
    ModelCallLedger,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      return ModelCallLedger.of({
        record: (c) =>
          sql`INSERT INTO model_call
                (purpose, submission_id, model, provider, simulated, outcome, http_status, input_tokens, output_tokens,
                 cost_usd, latency_ms, error, run_id)
              VALUES (${c.purpose}, ${c.submissionId ?? null}, ${c.model}, ${c.provider ?? null}, ${c.simulated}, ${c.outcome},
                 ${c.httpStatus ?? null}, ${c.inputTokens ?? null}, ${c.outputTokens ?? null}, ${c.costUsd ?? null},
                 ${Math.round(c.latencyMs)}, ${c.error?.slice(0, 1000) ?? null}, ${c.runId ?? null})`.pipe(
            Effect.asVoid,
            Effect.catch((e) => Effect.logWarning("model_call ledger write failed", e))
          )
      })
    })
  )

  /** In-memory ledger for the eval runner, which has no database. */
  static readonly memory = (calls: Ref.Ref<ReadonlyArray<ModelCallRecord>>) =>
    Layer.succeed(ModelCallLedger, ModelCallLedger.of({ record: (c) => Ref.update(calls, (all) => [...all, c]) }))
}
