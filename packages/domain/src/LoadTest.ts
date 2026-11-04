import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { AdminAuth } from "./Admin.ts"

/**
 * Operator endpoints for the load test (D-28), behind ADMIN_TOKEN. A run
 * creates its own teacher and published classes tagged with a run_id; the
 * generator then drives them through the public student and teacher API
 * like real browsers. Analysis reads the server's own clock.
 */
export const RunId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{2,63}$/))

export class LoadTestClasses extends Schema.Class<LoadTestClasses>("LoadTestClasses")({
  teacherSecret: Schema.String,
  classes: Schema.Array(Schema.Struct({ assignmentId: Schema.String, classCode: Schema.String, problemCount: Schema.Int }))
}) {}

export class QueueMetrics extends Schema.Class<QueueMetrics>("QueueMetrics")({
  at: Schema.DateTimeUtcFromString,
  queued: Schema.Int,
  running: Schema.Int,
  dead: Schema.Int,
  /** Age of the oldest job still waiting, in seconds: the queue's own latency. */
  oldestQueuedSec: Schema.Number,
  instanceId: Schema.String,
  uptimeSec: Schema.Int,
  /** Simulated provider calls in flight on THIS instance. */
  simulatorInFlight: Schema.Int
}) {}

const Percentiles = Schema.Struct({ n: Schema.Int, p50: Schema.NullOr(Schema.Number), p95: Schema.NullOr(Schema.Number), p99: Schema.NullOr(Schema.Number), max: Schema.NullOr(Schema.Number) })

export class RunAnalysis extends Schema.Class<RunAnalysis>("RunAnalysis")({
  runId: Schema.String,
  submissions: Schema.Int,
  byStatus: Schema.Record(Schema.String, Schema.Int),
  byReviewReason: Schema.Record(Schema.String, Schema.Int),
  /** Accepted by the API (2xx to the client) but absent from the database: must be empty. */
  missing: Schema.Array(Schema.String),
  /** In the database but not yet graded or flagged. */
  nonTerminal: Schema.Int,
  /** graded_at − accepted_at, seconds, server clock. */
  timeToGradeSec: Percentiles,
  firstAcceptedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastAcceptedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastGradedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  modelCalls: Schema.Record(Schema.String, Schema.Int),
  /** Provider latency of successful calls, ms (real for the canary, simulated otherwise). */
  modelLatencyMs: Percentiles,
  jobRetries: Schema.Int,
  deadJobs: Schema.Int,
  /** 10-second buckets from the first acceptance: where it slows down. */
  timeline: Schema.Array(Schema.Struct({ t: Schema.Int, accepted: Schema.Int, graded: Schema.Int, ttgP95: Schema.NullOr(Schema.Number) }))
}) {}

/** The crash endpoint exists only on a deploy made with ENABLE_CHAOS=1 (the chaos run); otherwise 404. */
export class ChaosDisabled extends Schema.TaggedError<ChaosDisabled>()(
  "ChaosDisabled",
  { message: Schema.String },
  { httpApiStatus: 404 }
) {}

export class LoadTestApi extends HttpApiGroup.make("loadtest")
  .add(
    HttpApiEndpoint.post("createClasses", "/classes", {
      payload: Schema.Struct({
        runId: RunId,
        classes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        problems: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
        /** false only for the calibration canary: real model calls, behind the budget guard (D-23). */
        simulated: Schema.Boolean
      }),
      success: LoadTestClasses
    }),
    HttpApiEndpoint.get("metrics", "/metrics", { success: QueueMetrics }),
    HttpApiEndpoint.post("analyze", "/runs/:runId/analyze", {
      params: { runId: RunId },
      payload: Schema.Struct({ acceptedIds: Schema.Array(Schema.String) }),
      success: RunAnalysis
    }),
    HttpApiEndpoint.delete("deleteRun", "/runs/:runId", {
      params: { runId: RunId },
      success: Schema.Struct({ assignments: Schema.Int, teachers: Schema.Int, jobs: Schema.Int, modelCalls: Schema.Int })
    }),
    /** Cleans up demo classes from /demo-class: they have no teacher and no run_id. */
    HttpApiEndpoint.delete("deleteLegacyDemoClasses", "/legacy-demo-classes", {
      success: Schema.Struct({ assignments: Schema.Int })
    }),
    /** Chaos check: this instance exits abruptly, with no graceful shutdown. */
    HttpApiEndpoint.post("crash", "/crash", { success: Schema.Struct({ instanceId: Schema.String }), error: ChaosDisabled })
  )
  .middleware(AdminAuth)
  .prefix("/admin/loadtest")
{}
