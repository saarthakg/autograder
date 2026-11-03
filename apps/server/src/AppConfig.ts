import { Config, Context, Duration, Effect, Layer, Redacted } from "effect"

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
      const concurrency = yield* Config.Int("MODEL_CONCURRENCY").pipe(Config.withDefault(32))
      const maxInFlightGlobal = yield* Config.Int("MODEL_MAX_IN_FLIGHT").pipe(Config.withDefault(64))
      const lease = yield* Config.Duration("JOB_LEASE").pipe(Config.withDefault(Duration.seconds(60)))
      const idlePoll = yield* Config.Duration("WORKER_IDLE_POLL").pipe(Config.withDefault(Duration.minutes(60)))
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
