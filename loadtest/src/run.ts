import { SAMPLE_PROBLEMS } from "@autograder/domain"
import { Duration, Effect, Fiber, Ref, Schema } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Scenario } from "./scenarios.ts"
import { classesToRun } from "./scenarios.ts"
import { buildTimeline, peakRate, type StudentPlan } from "./timeline.ts"

/**
 * Drives one run against a target, exactly as browsers would: students join
 * by class code, fetch their problems, submit real fixture drawings on a
 * precomputed schedule (open model: requests fire on time whether or not
 * earlier ones finished), and poll with the web app's own backoff while a
 * score is pending. Teachers poll their report. Latency is scored against
 * each request's SCHEDULED send time, so a slow server can't hide by slowing
 * the generator down.
 */
interface RunOptions {
  readonly target: string
  readonly adminToken: string
  readonly runId: string
  readonly scenario: Scenario
  readonly fixturesDir: string
  readonly log: (line: string) => void
}

export interface SubmitRecord {
  readonly scheduledMs: number
  readonly lagMs: number
  readonly firstLatencyMs: number
  readonly firstStatus: number
  readonly attempts: number
  readonly acceptedId: string | null
  readonly pngBytes: number
}

export interface MetricsSample {
  readonly tMs: number
  readonly queued: number
  readonly running: number
  readonly dead: number
  readonly oldestQueuedSec: number
  readonly instanceId: string
}

export interface RunResult {
  readonly runId: string
  readonly scenario: Scenario
  readonly target: string
  readonly startedAt: string
  readonly coldStartMs: number
  readonly dbWakeMs: number
  readonly students: number
  readonly classesRun: number
  readonly peakSubmitsPerSec: number
  readonly lastScheduledSubmitMs: number
  readonly joinFailures: number
  readonly submits: ReadonlyArray<SubmitRecord>
  readonly endpoints: Record<string, { latencies: Array<number>; statuses: Record<string, number>; bytes: number }>
  readonly lags: ReadonlyArray<number>
  readonly samples: ReadonlyArray<MetricsSample>
  readonly crash: { readonly atMs: number; readonly instanceId: string | null; readonly status: number } | null
  readonly drainWaitedSec: number
  readonly analysis: any
}

/** The run couldn't start or finish (bad token, target down, analysis failed). */
class LoadTestError extends Schema.TaggedError<LoadTestError>()("LoadTestError", { message: Schema.String }) {}

interface Res { readonly status: number; readonly json: any; readonly ms: number; readonly bytes: number }

/** One HTTP call; never fails: network errors and timeouts come back as status 0. */
const http = (target: string, method: string, path: string, opts: { token?: string | undefined; body?: string | undefined; timeoutMs?: number } = {}) =>
  Effect.promise(async (): Promise<Res> => {
    const started = performance.now()
    try {
      const r = await fetch(`${target}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: opts.body }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000)
      })
      const text = await r.text()
      let json: unknown = null
      try { json = text ? JSON.parse(text) : null } catch { json = null }
      return { status: r.status, json, ms: performance.now() - started, bytes: text.length }
    } catch {
      return { status: 0, json: null, ms: performance.now() - started, bytes: 0 }
    }
  })

const ok = (s: number) => s >= 200 && s < 300
const retryable = (s: number) => s === 0 || s >= 500 || s === 429

/**
 * Real fixture drawings, pre-serialised per sample problem. Only the
 * smallest legible drawing per problem is used: Neon Free's 5 GB/month
 * transfer is shared with prod, and the grade job reads each image back.
 */
const loadPayloads = (dir: string) => {
  const byKey = new Map<string, { strokes: string; png: string; pngBytes: number }>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const caseKey = file.replace(/\.json$/, "")
    if (caseKey.includes("illegible") || caseKey.includes("scribble")) continue // keep needs_review honest
    const problemKey = caseKey.split("-")[0]!
    const png = readFileSync(join(dir, `${caseKey}.png`))
    const current = byKey.get(problemKey)
    if (current && current.pngBytes <= png.byteLength) continue
    const fx = JSON.parse(readFileSync(join(dir, file), "utf8")) as { strokes: unknown }
    byKey.set(problemKey, { strokes: JSON.stringify(fx.strokes), png: png.toString("base64"), pngBytes: png.byteLength })
  }
  return byKey
}

export const runLoadTest = (o: RunOptions) =>
  Effect.gen(function*() {
    const s = o.scenario
    const admin = o.adminToken
    const call = (method: string, path: string, opts: { token?: string | undefined; body?: string | undefined; timeoutMs?: number } = {}) => http(o.target, method, path, opts)
    const payloads = loadPayloads(o.fixturesDir)
    const plans = buildTimeline(s)
    const classesRun = classesToRun(s)
    const lastScheduledSubmitMs = Math.max(...plans.flatMap((p) => p.submitAtMs))

    // --- warm up: cold start is measured and reported, never inside the SLOs (D-22) ------------
    const cold = yield* call("GET", "/api/health", { timeoutMs: 60_000 })
    let dbWakeMs = 0
    for (let i = 0; i < 10; i++) {
      const r = yield* call("GET", "/api/health/ready", { timeoutMs: 60_000 })
      dbWakeMs += r.ms
      if (ok(r.status)) break
      yield* Effect.sleep(Duration.seconds(1))
    }
    o.log(`warm: cold start ${Math.round(cold.ms)} ms (status ${cold.status}), DB ready after ${Math.round(dbWakeMs)} ms`)
    const auth = yield* call("GET", "/api/admin/loadtest/metrics", { token: admin })
    if (!ok(auth.status)) return yield* Effect.fail(new LoadTestError({ message: `admin token rejected or metrics unavailable (HTTP ${auth.status})` }))

    // --- set up the run's classes ----------------------------------------------------------------
    const setup = yield* call("POST", "/api/admin/loadtest/classes", {
      token: admin,
      body: JSON.stringify({ runId: o.runId, classes: classesRun, problems: s.problems, simulated: !s.realModel }),
      timeoutMs: 120_000
    })
    if (!ok(setup.status)) return yield* Effect.fail(new LoadTestError({ message: `could not create classes: HTTP ${setup.status} ${JSON.stringify(setup.json)}` }))
    const teacherSecret: string = setup.json.teacherSecret
    const classes: Array<{ assignmentId: string; classCode: string }> = setup.json.classes
    o.log(`run ${o.runId}: ${classesRun} classes × ${s.studentsPerClass} students × ${s.problems} problems, ${s.speed}× speed; last submit at ${(lastScheduledSubmitMs / 1000).toFixed(0)} s`)

    // --- recorders -------------------------------------------------------------------------------
    const endpoints: RunResult["endpoints"] = {}
    const record = (name: string, r: Res) => {
      const e = endpoints[name] ?? (endpoints[name] = { latencies: [], statuses: {}, bytes: 0 })
      e.latencies.push(r.ms)
      e.bytes += r.bytes
      e.statuses[String(r.status)] = (e.statuses[String(r.status)] ?? 0) + 1
    }
    const submits: Array<SubmitRecord> = []
    const lags: Array<number> = []
    const samples: Array<MetricsSample> = []
    let joinFailures = 0
    const done = yield* Ref.make(false)

    const t0 = performance.now() + 2_000 // a short lead so the first events aren't late by construction
    const now = () => performance.now() - t0
    const sleepUntil = (atMs: number) => Effect.suspend(() => {
      const wait = atMs - now()
      return wait > 0 ? Effect.sleep(Duration.millis(wait)) : Effect.void
    })

    // --- one student -----------------------------------------------------------------------------
    const student = (plan: StudentPlan) =>
      Effect.gen(function*() {
        yield* sleepUntil(plan.joinAtMs)
        lags.push(now() - plan.joinAtMs)
        const cls = classes[plan.classIndex]!
        let joined: Res | null = null
        for (let attempt = 0; attempt < 4; attempt++) {
          const r = yield* call("POST", "/api/join", { body: JSON.stringify({ classCode: cls.classCode, displayName: `Sim ${plan.classIndex + 1}-${plan.studentIndex + 1}` }) })
          record("join", r)
          if (ok(r.status)) { joined = r; break }
          if (!retryable(r.status)) break
          yield* Effect.sleep(Duration.seconds(2 ** attempt))
        }
        if (joined === null) { joinFailures++; return }
        const token: string = joined.json.token
        const home = yield* call("GET", "/api/student/me", { token })
        record("home", home)
        if (!ok(home.status)) { joinFailures++; return }
        const problems: Array<{ id: string; position: number }> = home.json.problems

        // Polls like the web app (usePoll): 2 s backing off ×1.5 to 8 s, only while something is pending.
        const pending = new Set<string>()
        const poller = yield* Effect.forkChild(Effect.gen(function*() {
          let delay = 2_000
          while (true) {
            if (pending.size === 0) { delay = 2_000; yield* Effect.sleep(Duration.millis(250)); continue }
            yield* Effect.sleep(Duration.millis(delay))
            delay = Math.min(8_000, Math.round(delay * 1.5))
            const r = yield* call("GET", "/api/student/me", { token })
            record("poll", r)
            if (ok(r.status)) for (const p of r.json.problems as Array<{ id: string; submission: { state: string } | null }>) if (p.submission && p.submission.state !== "grading") pending.delete(p.id)
          }
        }))

        for (const [i, atMs] of plan.submitAtMs.entries()) {
          const p = problems.find((x) => x.position === i + 1)
          if (!p) break
          yield* sleepUntil(atMs)
          const lag = now() - atMs
          lags.push(lag)
          const sample = SAMPLE_PROBLEMS[(p.position - 1) % SAMPLE_PROBLEMS.length]!.key
          const v = payloads.get(sample) ?? [...payloads.values()][0]!
          const body = `{"problemId":${JSON.stringify(p.id)},"idempotencyKey":"${crypto.randomUUID()}","strokes":${v.strokes},"imagePng":"${v.png}"}`
          // A real student whose submit fails presses Submit again: same key, so never a double submission.
          let first: Res | null = null
          let accepted: string | null = null
          let attempts = 0
          for (let attempt = 0; attempt < 5; attempt++) {
            attempts++
            const r = yield* call("POST", "/api/student/submissions", { token, body })
            record("submit", r)
            if (first === null) first = r
            if (ok(r.status)) { accepted = r.json.id; break }
            if (!retryable(r.status)) break
            yield* Effect.sleep(Duration.seconds(2 ** attempt))
          }
          submits.push({ scheduledMs: atMs, lagMs: lag, firstLatencyMs: lag + first!.ms, firstStatus: first!.status, attempts, acceptedId: accepted, pngBytes: v.pngBytes })
          if (accepted) pending.add(p.id)
        }
        // Keep polling until this student's scores are in (a real tab stays open), up to 3 minutes.
        const deadline = now() + 180_000
        while (pending.size > 0 && now() < deadline) yield* Effect.sleep(Duration.seconds(1))
        yield* Fiber.interrupt(poller)
      })

    // --- teachers poll their class report like the web app: 10 s backing off ×1.5 to 30 s, -----------
    // divided by speed so the request rate matches the real-world number of teachers.
    const teacher = (assignmentId: string) =>
      Effect.gen(function*() {
        let delay = 10_000
        while (!(yield* Ref.get(done))) {
          const r = yield* call("GET", `/api/teacher/assignments/${assignmentId}/report`, { token: teacherSecret })
          record("report", r)
          yield* Effect.sleep(Duration.millis(Math.max(500, delay / s.speed)))
          delay = Math.min(30_000, delay * 1.5)
        }
      })

    // --- queue depth and instances seen, every 5 s ----------------------------------------------
    const sampler = Effect.gen(function*() {
      while (true) {
        const r = yield* call("GET", "/api/admin/loadtest/metrics", { token: admin, timeoutMs: 10_000 })
        if (ok(r.status)) samples.push({ tMs: now(), queued: r.json.queued, running: r.json.running, dead: r.json.dead, oldestQueuedSec: r.json.oldestQueuedSec, instanceId: r.json.instanceId })
        yield* Effect.sleep(Duration.seconds(5))
      }
    })

    // --- the one chaos check: kill the serving instance mid-run, no graceful shutdown -------------
    let crash: RunResult["crash"] = null
    const chaos = s.crashAt === undefined ? Effect.void : Effect.gen(function*() {
      const at = lastScheduledSubmitMs * s.crashAt!
      yield* sleepUntil(at)
      const r = yield* call("POST", "/api/admin/loadtest/crash", { token: admin, timeoutMs: 10_000 })
      crash = { atMs: now(), instanceId: r.json?.instanceId ?? null, status: r.status }
      o.log(`chaos: crash requested at ${(now() / 1000).toFixed(0)} s → instance ${crash.instanceId ?? "?"} (HTTP ${r.status})`)
    })

    const progress = Effect.gen(function*() {
      while (true) {
        yield* Effect.sleep(Duration.seconds(30))
        const last = samples.at(-1)
        o.log(`t=${(now() / 1000).toFixed(0)}s submits=${submits.length} accepted=${submits.filter((x) => x.acceptedId).length} queue=${last ? `${last.queued}q/${last.running}r` : "?"}`)
      }
    })

    const background = yield* Effect.forkChild(Effect.all([sampler, progress], { concurrency: "unbounded" }))
    const teachers = yield* Effect.forkChild(Effect.forEach(classes, (c) => teacher(c.assignmentId), { concurrency: "unbounded", discard: true }))
    const chaosFiber = yield* Effect.forkChild(chaos)
    yield* Effect.forEach(plans, student, { concurrency: "unbounded", discard: true })
    yield* Fiber.join(chaosFiber)

    // --- drain: wait for the queue to empty (server clock decides the drain SLO) ------------------
    const drainStart = now()
    o.log(`all submits sent at ${(drainStart / 1000).toFixed(0)} s; waiting for the queue to drain…`)
    let quiet = 0
    while (now() - drainStart < 600_000 && quiet < 2) {
      const r = yield* call("GET", "/api/admin/loadtest/metrics", { token: admin, timeoutMs: 10_000 })
      quiet = ok(r.status) && r.json.queued === 0 && r.json.running === 0 ? quiet + 1 : 0
      yield* Effect.sleep(Duration.seconds(3))
    }
    yield* Ref.set(done, true)
    yield* Fiber.interrupt(teachers)
    yield* Fiber.interrupt(background)

    const acceptedIds = submits.flatMap((x) => (x.acceptedId ? [x.acceptedId] : []))
    const analysis = yield* call("POST", `/api/admin/loadtest/runs/${o.runId}/analyze`, { token: admin, body: JSON.stringify({ acceptedIds }), timeoutMs: 120_000 })
    if (!ok(analysis.status)) return yield* Effect.fail(new LoadTestError({ message: `analysis failed: HTTP ${analysis.status}` }))

    return {
      runId: o.runId,
      scenario: s,
      target: o.target,
      startedAt: new Date(Date.now() - now()).toISOString(),
      coldStartMs: cold.ms,
      dbWakeMs,
      students: plans.length,
      classesRun,
      peakSubmitsPerSec: peakRate(plans, s.speed),
      lastScheduledSubmitMs,
      joinFailures,
      submits,
      endpoints,
      lags,
      samples,
      crash,
      drainWaitedSec: (now() - drainStart) / 1000,
      analysis: analysis.json
    } satisfies RunResult
  })
