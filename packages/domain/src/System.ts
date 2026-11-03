import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

export class Health extends Schema.Class<Health>("Health")({
  status: Schema.Literal("ok"),
  version: Schema.String,
  /** Lets logs and probes tell instances and restarts apart. */
  instanceId: Schema.String,
  uptimeSec: Schema.Finite
}) {}

export class Readiness extends Schema.Class<Readiness>("Readiness")({
  db: Schema.Literal("ok"),
  dbLatencyMs: Schema.Finite
}) {}

export class DatabaseUnavailable extends Schema.TaggedError<DatabaseUnavailable>()(
  "DatabaseUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

/**
 * `/health` never touches Postgres, so uptime checks don't keep Neon awake
 * (D-20 A5). `/health/ready` does, for deploy verification.
 */
export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: Health }),
  HttpApiEndpoint.get("ready", "/health/ready", {
    success: Readiness,
    error: DatabaseUnavailable
  })
) {}
