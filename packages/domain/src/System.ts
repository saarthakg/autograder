import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

/** Which parts of the server a process runs (D-27: api and worker are separate services). */
export const Role = Schema.Literals(["api", "worker", "all"])
export type Role = typeof Role.Type

export class Health extends Schema.Class<Health>("Health")({
  status: Schema.Literal("ok"),
  role: Role,
  version: Schema.String,
  /** Lets us tell restarts apart, e.g. when checking the worker survived 20+ idle minutes. */
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
