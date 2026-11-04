import type { RunResult } from "./run.ts"
import { evaluate, type Measured, type SloConfig } from "./slo.ts"
import { fmt, summary } from "./stats.ts"

/** Blended real-model cost per grade at a 2% fallback rate: what this load would cost for real. */
const BLENDED_COST_PER_GRADE = 0.0003

/**
 * Estimated database egress (Neon counts bytes sent from Postgres): every
 * response body the app sent was read from Postgres first, plus each grade
 * job reading the submission's image and rubric back (~2 KB besides the PNG).
 * An estimate, stated as such in the report.
 */
export const transfer = (r: RunResult) => {
  const responses = Object.values(r.endpoints).reduce((n, e) => n + e.bytes, 0)
  const accepted = r.submits.filter((x) => x.acceptedId)
  const gradeReads = accepted.reduce((n, x) => n + x.pngBytes + 2048, 0)
  const total = responses + gradeReads
  return { totalBytes: total, perSubmitBytes: accepted.length === 0 ? 0 : total / accepted.length }
}

const measure = (r: RunResult): Measured => {
  const a = r.analysis
  const lastAccepted = a.lastAcceptedAt ? Date.parse(a.lastAcceptedAt) : null
  const lastGraded = a.lastGradedAt ? Date.parse(a.lastGradedAt) : null
  const needsReview = a.byStatus?.needs_review ?? 0
  return {
    lost: a.missing.length + a.nonTerminal,
    neverAccepted: r.submits.filter((x) => x.acceptedId === null).length,
    submitP99Ms: summary(r.submits.map((x) => x.firstLatencyMs)).p99,
    submitErrorRate: r.submits.length === 0 ? 0 : r.submits.filter((x) => x.firstStatus === 0 || x.firstStatus >= 500).length / r.submits.length,
    ttgP95Sec: a.timeToGradeSec.p95,
    ttgP99Sec: a.timeToGradeSec.p99,
    drainSec: lastAccepted !== null && lastGraded !== null ? Math.max(0, (lastGraded - lastAccepted) / 1000) : null,
    needsReviewRate: a.submissions === 0 ? 0 : needsReview / a.submissions,
    lagP99Ms: summary(r.lags).p99
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

const sparkline = (xs: ReadonlyArray<number>) => {
  const bars = "▁▂▃▄▅▆▇█"
  const max = Math.max(1, ...xs)
  return xs.map((x) => bars[Math.min(7, Math.floor((x / max) * 7.999))]).join("")
}

export const renderReport = (r: RunResult, slo: SloConfig) => {
  const s = r.scenario
  const m = measure(r)
  const ev = evaluate(slo, m, s.crashAt !== undefined)
  const a = r.analysis
  const instances = [...new Set(r.samples.map((x) => x.instanceId))]
  const maxQueue = Math.max(0, ...r.samples.map((x) => x.queued))
  const maxOldest = Math.max(0, ...r.samples.map((x) => x.oldestQueuedSec))

  // 30 s rows from the server's 10 s buckets, with queue depth sampled from the generator side.
  const rows: Array<{ t: number; accepted: number; graded: number; p95: number | null; queue: number }> = []
  for (const b of a.timeline as Array<{ t: number; accepted: number; graded: number; ttgP95: number | null }>) {
    const t = Math.floor(b.t / 30) * 30
    let row = rows.find((x) => x.t === t)
    if (!row) { row = { t, accepted: 0, graded: 0, p95: null, queue: 0 }; rows.push(row) }
    row.accepted += b.accepted
    row.graded += b.graded
    if (b.ttgP95 !== null) row.p95 = Math.max(row.p95 ?? 0, b.ttgP95)
  }
  const firstAcceptMs = a.firstAcceptedAt ? Date.parse(a.firstAcceptedAt) : null
  const runStartMs = Date.parse(r.startedAt)
  for (const row of rows) {
    const from = (firstAcceptMs ?? runStartMs) - runStartMs + row.t * 1000
    row.queue = Math.max(0, ...r.samples.filter((x) => x.tMs >= from && x.tMs < from + 30_000).map((x) => x.queued))
  }
  rows.sort((x, y) => x.t - y.t)

  const endpointRows = Object.entries(r.endpoints).map(([name, e]) => {
    const st = summary(e.latencies)
    const errors = Object.entries(e.statuses).filter(([code]) => !code.startsWith("2")).map(([code, n]) => `${code === "0" ? "network/timeout" : code}×${n}`).join(", ")
    return `| ${name} | ${st.n} | ${fmt(st.p50)} | ${fmt(st.p95)} | ${fmt(st.p99)} | ${fmt(st.max)} | ${errors || "none"} |`
  })

  const verdictLine = ev.verdict === "SHIP" ? "**SHIP**: every gated SLO passed." : ev.verdict === "NO-SHIP" ? "**NO-SHIP**: at least one gated SLO failed (below)." : "**INVALID**: the generator itself fell behind, so this run can't judge the server. Re-run from a less loaded machine or at a lower speed."
  const realRate = r.peakSubmitsPerSec

  return {
    verdict: ev.verdict,
    markdown: `# Load test ${r.runId}: ${ev.verdict}

${verdictLine}

- **Scenario:** \`${s.name}\`. ${s.description}
- **Target:** ${r.target} · started ${r.startedAt}
- **Ran:** ${plural(r.classesRun, "class", "classes")} × ${s.studentsPerClass} students × ${s.problems} problems = ${r.students} students, ${r.submits.length} submits, at ${s.speed}× speed. Peak arrival **${realRate.toFixed(1)} submits/s** (60 s window): the rate of ${plural(r.classesRun * s.speed, "real class", "real classes")} (${(r.classesRun * s.speed * s.studentsPerClass).toLocaleString()} students) working in real time.
- **Grading:** ${s.realModel ? "REAL model calls (canary)" : "in-process simulator: calibrated latency, injected 429/5xx/invalid output"}.
- **Cold start (excluded from SLOs):** first request ${Math.round(r.coldStartMs)} ms; database ready after ${Math.round(r.dbWakeMs)} ms.
- **Instances seen:** ${instances.length} (${instances.join(", ") || "none"}).${r.crash ? `\n- **Chaos:** crashed instance \`${r.crash.instanceId ?? "?"}\` at ${(r.crash.atMs / 1000).toFixed(0)} s (HTTP ${r.crash.status}).` : ""}

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
${ev.results.map((x) => `| ${x.name} | ${x.target} | ${x.actual} | ${x.outcome} |`).join("\n")}
| Generator lag p99 (validity gate) | ${ev.lag.target} | ${ev.lag.actual} | ${ev.valid ? "VALID" : "INVALID"} |

${s.crashAt !== undefined ? "Under chaos, latency, error rate and time to grade are reported, not gated: the instance is killed on purpose. What must hold is that nothing is lost, every submit is eventually accepted, and the backlog drains.\n" : ""}
## Where it slows down

Queue depth peaked at **${maxQueue}** jobs; the oldest waiting job was **${maxOldest.toFixed(1)} s** old at worst.

Accepted per 10 s: \`${sparkline((a.timeline as Array<{ accepted: number }>).map((b) => b.accepted))}\`
Graded per 10 s:   \`${sparkline((a.timeline as Array<{ graded: number }>).map((b) => b.graded))}\`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
${rows.map((x) => `| ${x.t} | ${x.accepted} | ${x.graded} | ${fmt(x.p95, 1)} | ${x.queue} |`).join("\n")}

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
${endpointRows.join("\n")}

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: ${a.submissions} (${Object.entries(a.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}); flagged reasons: ${Object.entries(a.byReviewReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.
- Time to grade (s): p50 ${fmt(a.timeToGradeSec.p50, 1)}, p95 ${fmt(a.timeToGradeSec.p95, 1)}, p99 ${fmt(a.timeToGradeSec.p99, 1)}, max ${fmt(a.timeToGradeSec.max, 1)}.
- Model calls by outcome: ${Object.entries(a.modelCalls).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. Job retries ${a.jobRetries}, dead jobs ${a.deadJobs}.
- Model latency, successful calls (ms): p50 ${fmt(a.modelLatencyMs.p50)}, p95 ${fmt(a.modelLatencyMs.p95)}, p99 ${fmt(a.modelLatencyMs.p99)}, max ${fmt(a.modelLatencyMs.max)} (${s.realModel ? "REAL provider" : "simulator"}).
- Estimated database transfer: **${(transfer(r).totalBytes / 1e6).toFixed(1)} MB**, ${(transfer(r).perSubmitBytes / 1e3).toFixed(1)} KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: ${r.submits.filter((x) => x.acceptedId).length}; missing ${a.missing.length}; not terminal after drain ${a.nonTerminal}.
- Join failures: ${r.joinFailures}. Drain wait: ${r.drainWaitedSec.toFixed(0)} s.
- Projected real-model cost of this load: ${a.submissions} grades × $${BLENDED_COST_PER_GRADE} ≈ **$${(a.submissions * BLENDED_COST_PER_GRADE).toFixed(2)}** (blended Luna + 2% sol fallback); this run spent ${s.realModel ? "real money (canary)" : "$0 on models"}.
`
  }
}
