import { ProblemInput } from "@autograder/domain"
import { useState } from "react"
import { call, friendly } from "../api.ts"
import { MathText } from "../components/Math.tsx"
import { ensureWorkspace } from "../Landing.tsx"
import { navigate } from "../lib/router.ts"

interface Draft { prompt: string; answerKey: string; maxPoints: number }
const blank = (): Draft => ({ prompt: "", answerKey: "", maxPoints: 3 })

/** Type problems (math in $...$); each gets a drafted, editable rubric. */
export function NewAssignment() {
  const [title, setTitle] = useState("")
  const [problems, setProblems] = useState<Array<Draft>>([blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<Draft>) => setProblems((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const ready = title.trim() !== "" && problems.every((p) => p.prompt.trim() !== "")

  const create = async () => {
    setBusy(true); setError(null)
    const secret = await ensureWorkspace()
    if (!secret) { setBusy(false); setError("Couldn't start a workspace. Try again."); return }
    const r = await call({ teacher: secret }, (c) => c.teacher.createAssignment({
      payload: {
        title: title.trim(),
        problems: problems.map((p) => new ProblemInput({ prompt: p.prompt.trim(), answerKey: p.answerKey.trim() || null, maxPoints: p.maxPoints }))
      }
    }))
    setBusy(false)
    if (r.ok) navigate(`/t/a/${r.value.id}`)
    else setError(friendly(r))
  }

  return (
    <main className="page narrow">
      <header className="page-head"><h1>New assignment</h1></header>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Linear equations quiz" maxLength={120} />
      </label>
      <ol className="problem-inputs">
        {problems.map((p, i) => (
          <li key={i} className="problem-input">
            <div className="row-between">
              <strong>Problem {i + 1}</strong>
              {problems.length > 1 && <button className="link" onClick={() => setProblems((ps) => ps.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            <label className="field">
              <span>Problem <span className="muted small">(put math between dollar signs: $3(x - 2) = 2x + 5$)</span></span>
              <textarea rows={2} value={p.prompt} onChange={(e) => update(i, { prompt: e.target.value })} maxLength={1000} />
            </label>
            {p.prompt.includes("$") && <p className="preview"><MathText text={p.prompt} /></p>}
            <div className="row">
              <label className="field grow">
                <span>Answer key <span className="muted small">(optional, but it helps the rubric)</span></span>
                <input value={p.answerKey} onChange={(e) => update(i, { answerKey: e.target.value })} placeholder="x = 11" />
              </label>
              <label className="field">
                <span>Points</span>
                <select value={p.maxPoints} onChange={(e) => update(i, { maxPoints: Number(e.target.value) })}>
                  {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ol>
      {problems.length < 10 && <button onClick={() => setProblems((ps) => [...ps, blank()])}>+ Add a problem</button>}
      <div className="actions">
        <button className="primary big" disabled={!ready || busy} onClick={create}>
          {busy ? "Drafting rubrics…" : "Create and draft rubrics"}
        </button>
        {busy && <span className="muted">This takes a few seconds per problem.</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  )
}
