import { Config, Context, Duration, Effect, Layer, Option, Redacted } from "effect"
import { fileURLToPath } from "node:url"

/**
 * Everything the server reads from the environment, parsed once at startup.
 * A missing or malformed value fails boot loudly instead of defaulting silently (P20).
 */
export class AppConfig extends Context.Service<AppConfig, {
  readonly port: number
  readonly version: string
  readonly databaseUrl: Redacted.Redacted
  readonly dbPoolMax: number
  readonly adminToken: Redacted.Redacted
  /** Serve the built web app from here. */
  readonly webDist: string
  readonly promptsDir: string
  /** Dev-only fixture capture target (D-18); None disables POST /admin/fixtures. */
  readonly fixtureDir: Option.Option<string>
  readonly model: {
    /** None = real grading unavailable (simulated assignments still work, D-28). */
    readonly apiKey: Option.Option<Redacted.Redacted>
    readonly baseUrl: string
    readonly gradingModel: string
    /** Tried in order by OpenRouter if the primary fails (D-30): config only, no code path. */
    readonly gradingFallbackModels: ReadonlyArray<string>
    /** OpenRouter `provider.order` for grading calls: the primary's providers, tried in order before a fallback model (D-30). */
    readonly gradingProviderOrder: ReadonlyArray<string>
    readonly rubricModel: string
    readonly timeout: Duration.Duration
    /** Refuse model-spending work once key credit would fall below this (P25). */
    readonly budgetFloorUsd: number
  }
  /** In-process model simulator for load-test assignments (D-28). */
  readonly simulation: {
    readonly latencyMedianMs: number
    readonly latencySigma: number
    readonly rate429: number
    readonly rate5xx: number
    readonly rateInvalid: number
    readonly maxConcurrent: number
  }
  readonly worker: {
    readonly concurrency: number
    readonly maxInFlightGlobal: number
    readonly lease: Duration.Duration
    /** Longest the idle worker sleeps without a wake; long so Neon can scale to zero (D-20 A5). */
    readonly idlePoll: Duration.Duration
    /** How long in-flight jobs get after SIGTERM before we rely on leases (Cloud Run allows ~10 s). */
    readonly shutdownGrace: Duration.Duration
  }
}>()("autograder/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function*() {
      const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000))
      const version = yield* Config.String("APP_VERSION").pipe(Config.withDefault("dev"))
      const databaseUrl = yield* Config.Redacted("DATABASE_URL")
      const dbPoolMax = yield* Config.Int("DB_POOL_MAX").pipe(Config.withDefault(10))
      const adminToken = yield* Config.Redacted("ADMIN_TOKEN")
      const webDist = yield* Config.String("WEB_DIST").pipe(Config.withDefault("../web/dist"))
      const promptsDir = yield* Config.String("PROMPTS_DIR").pipe(
        Config.withDefault(fileURLToPath(new URL("../../../prompts", import.meta.url)))
      )
      const fixtureDir = yield* Config.option(Config.String("FIXTURE_DIR"))
      const apiKey = yield* Config.option(Config.Redacted("OPENROUTER_API_KEY"))
      const baseUrl = yield* Config.String("MODEL_BASE_URL").pipe(Config.withDefault("https://openrouter.ai/api/v1"))
      // Chosen by the Phase 2 eval (D-19): cheapest model clearing every gate.
      const gradingModel = yield* Config.String("GRADING_MODEL").pipe(Config.withDefault("openai/gpt-6-luna"))
      // D-30: the hard set caught gemini-3.1-flash-lite inventing work on an unreadable drawing; sol never did.
      const gradingFallbacks = yield* Config.String("GRADING_FALLBACK_MODELS").pipe(Config.withDefault("openai/gpt-6.1-sol"))
      const providerOrder = yield* Config.String("GRADING_PROVIDER_ORDER").pipe(Config.withDefault("openai,azure"))
      const rubricModel = yield* Config.String("RUBRIC_MODEL").pipe(Config.withDefault("openai/gpt-6.1-terra"))
      const modelTimeout = yield* Config.Duration("MODEL_TIMEOUT").pipe(Config.withDefault(Duration.seconds(60)))
      const budgetFloorUsd = yield* Config.Finite("BUDGET_FLOOR_USD").pipe(Config.withDefault(5))
      const concurrency = yield* Config.Int("MODEL_CONCURRENCY").pipe(Config.withDefault(32))
      const maxInFlightGlobal = yield* Config.Int("MODEL_MAX_IN_FLIGHT").pipe(Config.withDefault(64))
      const lease = yield* Config.Duration("JOB_LEASE").pipe(Config.withDefault(Duration.seconds(60)))
      const idlePoll = yield* Config.Duration("WORKER_IDLE_POLL").pipe(Config.withDefault(Duration.minutes(60)))
      // Defaults fitted to openai/gpt-6-luna in the Phase 2 eval: p50 3.4 s, p95 4.5 s (sigma = ln(4.5/3.4)/1.645).
      // The canary re-measures the real path; LOADTEST.md compares the two.
      const simulation = {
        latencyMedianMs: yield* Config.Int("SIM_LATENCY_MEDIAN_MS").pipe(Config.withDefault(3400)),
        latencySigma: yield* Config.Finite("SIM_LATENCY_SIGMA").pipe(Config.withDefault(0.17)),
        rate429: yield* Config.Finite("SIM_RATE_429").pipe(Config.withDefault(0.02)),
        rate5xx: yield* Config.Finite("SIM_RATE_5XX").pipe(Config.withDefault(0.01)),
        rateInvalid: yield* Config.Finite("SIM_RATE_INVALID").pipe(Config.withDefault(0.005)),
        maxConcurrent: yield* Config.Int("SIM_MAX_CONCURRENT").pipe(Config.withDefault(64))
      }
      const shutdownGrace = yield* Config.Duration("WORKER_SHUTDOWN_GRACE").pipe(
        Config.withDefault(Duration.seconds(8))
      )
      return AppConfig.of({
        port,
        version,
        databaseUrl,
        dbPoolMax,
        adminToken,
        webDist,
        promptsDir,
        fixtureDir,
        model: {
          // An empty OPENROUTER_API_KEY= line counts as unset.
          apiKey: Option.filter(apiKey, (k) => Redacted.value(k) !== ""),
          baseUrl: baseUrl.replace(/\/$/, ""),
          gradingModel,
          gradingFallbackModels: list(gradingFallbacks),
          gradingProviderOrder: list(providerOrder),
          rubricModel,
          timeout: modelTimeout,
          budgetFloorUsd
        },
        simulation,
        worker: {
          concurrency,
          maxInFlightGlobal,
          lease,
          idlePoll,
          shutdownGrace
        }
      })
    })
  )
}

const list = (csv: string) => csv.split(",").map((s) => s.trim()).filter(Boolean)
