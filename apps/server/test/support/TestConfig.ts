import { Duration, Layer, Option, Redacted } from "effect"
import { fileURLToPath } from "node:url"
import { AppConfig } from "../../src/AppConfig.ts"

export const testConfig = (
  overrides: Partial<AppConfig["Service"]["worker"]> = {},
  model: Partial<AppConfig["Service"]["model"]> = {}
) =>
  Layer.succeed(
    AppConfig,
    AppConfig.of({
      port: 0,
      version: "test",
      databaseUrl: Redacted.make("unused"),
      dbPoolMax: 5,
      adminToken: Redacted.make("test-token"),
      webDist: "/nonexistent",
      fixtureDir: Option.none(),
      promptsDir: fileURLToPath(new URL("../../../../prompts", import.meta.url)),
      model: {
        apiKey: Option.some(Redacted.make("test-key")),
        baseUrl: "https://model.test/api/v1",
        gradingModel: "test/grader",
        gradingFallbackModels: [],
        gradingProviderOrder: [],
        rubricModel: "test/rubric",
        timeout: Duration.seconds(5),
        budgetFloorUsd: 5,
        ...model
      },
      simulation: { latencyMedianMs: 5, latencySigma: 0, rate429: 0, rate5xx: 0, rateInvalid: 0, maxConcurrent: 100 },
      worker: {
        concurrency: 4,
        maxInFlightGlobal: 100,
        lease: Duration.seconds(30),
        heartbeat: Duration.seconds(10),
        idlePoll: Duration.minutes(60),
        shutdownGrace: Duration.millis(200),
        ...overrides
      }
    })
  )
