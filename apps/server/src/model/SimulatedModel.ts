import { Context, Duration, Effect, Layer, Random } from "effect"
import { AppConfig } from "../AppConfig.ts"
import { ModelError, type ModelRequest, type ModelResponse } from "./ModelClient.ts"

/**
 * The in-process model simulator for load-test assignments (D-28). Same interface as the real client, so the Grader, its retry on
 * invalid output, the ledger, the queue's backoff and Retry-After handling
 * all run for real. Only the network hop to a provider is skipped.
 *
 * - Latency is lognormal, calibrated from measured real calls (eval, canary).
 * - Faults are injected at configured rates: 429 with Retry-After, 5xx, and
 *   schema-invalid output. A per-instance concurrency cap answers 429 too,
 *   like a provider's rate limit.
 * - Verdicts are deterministic per submission (seeded by its id), so reruns
 *   are comparable.
 */
export interface SimulationConfig {
  readonly latencyMedianMs: number
  readonly latencySigma: number
  readonly rate429: number
  readonly rate5xx: number
  readonly rateInvalid: number
  readonly maxConcurrent: number
}

export class SimulatedModel extends Context.Service<SimulatedModel, {
  readonly complete: (request: ModelRequest) => Effect.Effect<ModelResponse, ModelError>
  readonly inFlight: () => number
}>()("autograder/SimulatedModel") {
  static readonly layer = Layer.effect(SimulatedModel, Effect.gen(function*() {
    const config = yield* AppConfig
    return make(config.simulation)
  }))
}

/** FNV-1a: a cheap, stable hash for per-submission determinism. */
const hash = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

export const make = (sim: SimulationConfig) => {
  let inFlight = 0

  const complete = (request: ModelRequest) =>
    Effect.gen(function*() {
      const started = Date.now()
      if (inFlight >= sim.maxConcurrent) {
        return yield* new ModelError({ kind: "rate_limited", message: "simulated provider concurrency cap", httpStatus: 429, retryAfter: Duration.seconds(2), latencyMs: 5 })
      }
      inFlight++
      return yield* Effect.gen(function*() {
        // Box-Muller normal -> lognormal latency.
        const u1 = Math.max(1e-9, yield* Random.next)
        const u2 = yield* Random.next
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
        const latencyMs = Math.round(sim.latencyMedianMs * Math.exp(sim.latencySigma * z))
        const roll = yield* Random.next
        if (roll < sim.rate429) {
          yield* Effect.sleep(Duration.millis(Math.min(latencyMs, 300)))
          return yield* new ModelError({ kind: "rate_limited", message: "simulated 429", httpStatus: 429, retryAfter: Duration.seconds(1 + Math.floor(roll * 1000) % 3), latencyMs: Date.now() - started })
        }
        yield* Effect.sleep(Duration.millis(latencyMs))
        if (roll < sim.rate429 + sim.rate5xx) {
          return yield* new ModelError({ kind: "provider_error", message: "simulated 502", httpStatus: 502, latencyMs: Date.now() - started })
        }
        const invalid = roll < sim.rate429 + sim.rate5xx + sim.rateInvalid && request.correction === undefined
        return {
          model: "simulated/grader",
          provider: "Simulator",
          content: invalid ? "{\"criteria\": \"not what the schema wants\"}" : JSON.stringify(output(request)),
          inputTokens: 900,
          outputTokens: 220,
          costUsd: 0,
          latencyMs: Date.now() - started,
          httpStatus: 200
        } satisfies ModelResponse
      }).pipe(Effect.ensuring(Effect.sync(() => { inFlight-- })))
    })

  return SimulatedModel.of({ complete, inFlight: () => inFlight })
}

/** A schema-valid grade over the request's real criterion ids, deterministic per seed. */
const output = (request: ModelRequest) => {
  const s = request.simulate
  const ids = s?.criterionIds ?? []
  const h = hash(s?.seed ?? request.text)
  return {
    transcription: "simulated work",
    legible: true,
    criteria: ids.map((id, i) => ({
      id,
      // About 70% of criteria met, varied per submission and criterion.
      verdict: ((h >>> (i * 3)) % 10) < 7 ? "met" : "not_met",
      evidence: "simulated"
    })),
    confidence: "high"
  }
}
