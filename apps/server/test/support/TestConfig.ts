import { Duration, Layer, Option, Redacted } from "effect"
import { AppConfig } from "../../src/AppConfig.ts"

export const testConfig = (overrides: Partial<AppConfig["Service"]["worker"]> = {}) =>
  Layer.succeed(
    AppConfig,
    AppConfig.of({
      role: "all",
      port: 0,
      version: "test",
      databaseUrl: Redacted.make("unused"),
      dbPoolMax: 5,
      internalToken: Redacted.make("test-token"),
      workerWakeUrl: Option.none(),
      webDist: "/nonexistent",
      worker: {
        concurrency: 4,
        maxInFlightGlobal: 100,
        lease: Duration.seconds(30),
        idlePoll: Duration.minutes(60),
        shutdownGrace: Duration.millis(200),
        ...overrides
      }
    })
  )
