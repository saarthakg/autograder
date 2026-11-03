import { Duration, Layer, Redacted } from "effect"
import { AppConfig } from "../../src/AppConfig.ts"

export const testConfig = (overrides: Partial<AppConfig["Service"]["worker"]> = {}) =>
  Layer.succeed(
    AppConfig,
    AppConfig.of({
      port: 0,
      version: "test",
      databaseUrl: Redacted.make("unused"),
      dbPoolMax: 5,
      adminToken: Redacted.make("test-token"),
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
