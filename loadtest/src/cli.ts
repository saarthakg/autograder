import { Effect } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderReport } from "./report.ts"
import { runLoadTest } from "./run.ts"
import { classesToRun, SCENARIOS } from "./scenarios.ts"
import { DEFAULT_SLO } from "./slo.ts"

/**
 *   bun run loadtest --scenario testing-day --target https://<url>
 *   bun run loadtest --scenario smoke --target http://localhost:3000
 *   bun run loadtest --scenario canary --target <url> --yes     # real model calls
 *   bun run loadtest:cleanup --run-id <id> --target <url>       # or --legacy-demo
 *
 * Options: --classes N (real-world classes), --speed N, --scale K (multiplies
 * classes, to find where it breaks), --crash-at F (crash the serving instance
 * at fraction F of the run), --keep (skip cleanup), --admin-token T
 * (default: LOADTEST_ADMIN_TOKEN, then ADMIN_TOKEN from .env).
 * Exit code: 0 SHIP, 1 NO-SHIP, 2 INVALID, 3 error.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")

const target = (arg("target") ?? "http://localhost:3000").replace(/\/$/, "")
const adminToken = arg("admin-token") ?? process.env.LOADTEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? ""
const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)

const call = async (method: string, path: string) => {
  const r = await fetch(`${target}${path}`, { method, headers: { authorization: `Bearer ${adminToken}` } })
  return { status: r.status, json: await r.json().catch(() => null) }
}

const cleanup = async (runId: string) => {
  const r = await call("DELETE", `/api/admin/loadtest/runs/${runId}`)
  log(`cleanup ${runId}: HTTP ${r.status} ${JSON.stringify(r.json)}`)
  return r.status >= 200 && r.status < 300
}

const main = async () => {
  if (!adminToken) { console.error("No admin token: pass --admin-token or set LOADTEST_ADMIN_TOKEN / ADMIN_TOKEN."); return 3 }

  if (flag("cleanup")) {
    if (flag("legacy-demo")) {
      const r = await call("DELETE", "/api/admin/loadtest/legacy-demo-classes")
      log(`legacy demo classes: HTTP ${r.status} ${JSON.stringify(r.json)}`)
    }
    const runId = arg("run-id")
    if (runId) return (await cleanup(runId)) ? 0 : 3
    return flag("legacy-demo") ? 0 : (console.error("cleanup needs --run-id <id> and/or --legacy-demo"), 3)
  }

  const base = SCENARIOS[arg("scenario") ?? "smoke"]
  if (!base) { console.error(`Unknown scenario. Choose: ${Object.keys(SCENARIOS).join(", ")}`); return 3 }
  const scale = Number(arg("scale") ?? 1)
  const scenario = {
    ...base,
    classes: Math.round(Number(arg("classes") ?? base.classes) * scale),
    speed: Number(arg("speed") ?? base.speed),
    ...(arg("crash-at") === undefined ? {} : { crashAt: Number(arg("crash-at")) })
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)
  const runId = arg("run-id") ?? `lt-${scenario.name}${scale !== 1 ? `-x${scale}` : ""}-${stamp}`

  if (scenario.realModel) {
    const grades = classesToRun(scenario) * scenario.studentsPerClass * scenario.problems
    // Measured blended cost (D-30) with the eval's safety margins: ×1.25 retries, ×1.5 safety.
    const projected = grades * 0.0003 * 1.25 * 1.5
    log(`canary: ${grades} REAL grades, projected ≈ $${projected.toFixed(3)} (budget guard floor applies)`)
    if (!flag("yes")) { log("Projection only. Re-run with --yes to spend it."); return 0 }
  }

  const result = await Effect.runPromise(runLoadTest({ target, adminToken, runId, scenario, fixturesDir: join(root, "evals", "fixtures"), log }))
  const { verdict, markdown } = renderReport(result, DEFAULT_SLO)
  const dir = join(here, "..", "reports", runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "report.md"), markdown)
  writeFileSync(join(dir, "raw.json"), JSON.stringify(result))
  log(`report: ${join(dir, "report.md")}`)
  console.log(`\n${markdown.split("\n## Where")[0]}`)
  if (!flag("keep")) await cleanup(runId)
  else log(`kept: delete later with bun run loadtest:cleanup --run-id ${runId} --target ${target}`)
  return verdict === "SHIP" ? 0 : verdict === "NO-SHIP" ? 1 : 2
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(3) })
