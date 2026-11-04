import { EVAL_CASES, instructionHash, SAMPLE_PROBLEMS, type Stroke } from "@autograder/domain"
import { useCallback, useState } from "react"
import { call } from "../api.ts"
import { renderPng } from "../whiteboard/ink.ts"
import { Whiteboard } from "../whiteboard/Whiteboard.tsx"

const TOKEN_KEY = "ag-admin-token"
const SAVED_KEY = "ag-saved-fixtures"
const read = (k: string) => {
  try { return localStorage.getItem(k) ?? "" } catch { return "" }
}
const write = (k: string, v: string) => {
  try { localStorage.setItem(k, v) } catch { /* private mode: progress just isn't remembered */ }
}

/**
 * Dev-only fixture capture (D-18): draw each gold case in the real
 * whiteboard and save its strokes + the exact PNG the grader would see to
 * evals/fixtures/ (via the local server's FIXTURE_DIR). Not in production
 * builds. Run locally, then open http://localhost:5173/dev/fixtures:
 *   FIXTURE_DIR=../../evals/fixtures bun run dev   and   cd apps/web && bun run dev
 */
export function FixtureCapture() {
  const [token, setToken] = useState(read(TOKEN_KEY))
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set(read(SAVED_KEY).split(",").filter(Boolean)))
  const [index, setIndex] = useState(() => Math.max(0, EVAL_CASES.findIndex((c) => !saved.has(c.key))))
  const [strokes, setStrokes] = useState<ReadonlyArray<Stroke>>([])
  const [resetKey, setResetKey] = useState(0)
  const [status, setStatus] = useState<string>("")
  const [preview, setPreview] = useState<string | null>(null)
  const onChange = useCallback((s: ReadonlyArray<Stroke>) => setStrokes(s), [])

  const current = EVAL_CASES[index]!
  const problem = SAMPLE_PROBLEMS.find((p) => p.key === current.problem)!

  const save = async () => {
    setStatus("Saving…")
    try {
      const png = await renderPng(strokes)
      const r = await call({ admin: token }, (c) => c.admin.saveFixture({ payload: { caseKey: current.key, instructionHash: instructionHash(current), strokes, imagePng: png } }))
      if (!r.ok) throw new Error(r.message)
      const next = new Set(saved).add(current.key)
      setSaved(next)
      write(SAVED_KEY, [...next].join(","))
      setPreview(URL.createObjectURL(new Blob([png.slice()], { type: "image/png" })))
      setStatus(`Saved ${current.key} (${(png.byteLength / 1024).toFixed(1)} KB PNG)`)
      setResetKey((k) => k + 1)
      const nextIndex = EVAL_CASES.findIndex((c) => !next.has(c.key))
      if (nextIndex >= 0) setIndex(nextIndex)
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`)
    }
  }

  return (
    <main className="fixtures">
      <header>
        <h1>Fixture capture</h1>
        <label>
          Admin token{" "}
          <input type="password" value={token} onChange={(e) => { setToken(e.target.value); write(TOKEN_KEY, e.target.value) }} />
        </label>
        <span>{saved.size} / {EVAL_CASES.length} saved</span>
      </header>
      <div className="fixtures-body">
        <ol className="case-list">
          {EVAL_CASES.map((c, i) => (
            <li key={c.key}>
              <button aria-current={i === index} onClick={() => { setIndex(i); setResetKey((k) => k + 1) }}>
                {saved.has(c.key) ? "✓ " : ""}{c.key}
              </button>
            </li>
          ))}
        </ol>
        <section>
          <p className="problem"><strong>Problem {problem.key.slice(1)}:</strong> {problem.prompt.replace(/\$/g, "")}</p>
          <p className="draw"><strong>Draw ({current.kind}):</strong> {current.draw.split("↵").join(" / then a new line: ")}</p>
          <p className="gold">Gold: {current.expect === "abstain" ? "model should abstain" : current.expect.map((v, i) => `c${i + 1}=${v ? "met" : "not met"}`).join(", ")}</p>
          <Whiteboard width={900} height={420} onChange={onChange} resetKey={resetKey} />
          <div className="actions">
            <button className="primary" disabled={strokes.length === 0 || token === ""} onClick={save}>
              Save fixture {saved.has(current.key) ? "(overwrite)" : ""}
            </button>
            <span role="status">{status}</span>
          </div>
          {preview && (
            <figure>
              <figcaption>What the grader sees:</figcaption>
              <img src={preview} alt="last saved fixture as sent to the model" style={{ maxWidth: 420, border: "1px solid #ddd" }} />
            </figure>
          )}
        </section>
      </div>
    </main>
  )
}
