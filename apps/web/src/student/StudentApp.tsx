import type { Stroke, StudentHome, StudentProblem } from "@autograder/domain"
import { useCallback, useEffect, useState } from "react"
import { call, friendly } from "../api.ts"
import { MathText } from "../components/Math.tsx"
import { navigate } from "../lib/router.ts"
import { drawingKey, type StudentSession, studentSession } from "../lib/storage.ts"
import { usePoll } from "../lib/usePoll.ts"
import { renderPng } from "../whiteboard/ink.ts"
import { Whiteboard } from "../whiteboard/Whiteboard.tsx"

const GOBLINS_URL = "https://goblinsapp.com"

/**
 * The student's assignment. Submit never waits on the grader (P8): it returns
 * at once, the student moves on, and the score fills in on that problem's chip.
 */
export function StudentApp() {
  const [session] = useState<StudentSession | null>(() => studentSession.read())
  const [home, setHome] = useState<StudentHome | null>(null)
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!session) return
    const r = await call({ student: session.token }, (c) => c.student.home())
    if (r.ok) setHome(r.value)
    else if (r.tag === "Unauthorized") { studentSession.forget(); navigate("/join") }
    else setError(friendly(r))
  }, [session])
  useEffect(() => { refresh() }, [refresh])

  const grading = home?.problems.some((p) => p.submission?.state === "grading") ?? false
  usePoll(refresh, grading) // only while a score is pending (D-24)

  if (!session) { navigate("/join"); return null }
  if (error) return <main className="page"><p className="error">{error}</p></main>
  if (home === null) return <main className="page"><p className="muted">Loading…</p></main>

  const allDone = home.problems.every((p) => p.submission !== null)
  const problem = home.problems[current]

  return (
    <main className="student">
      <header className="student-head">
        <div>
          <strong>{home.assignmentTitle}</strong>
          <span className="muted small"> · {home.displayName}</span>
        </div>
        <span className="muted small" title="Use this with the class code to get back in on another device">
          Rejoin code: <strong className="mono">{home.rejoinCode}</strong>
        </span>
      </header>
      <nav className="chips" aria-label="Problems">
        {home.problems.map((p, i) => (
          <button key={p.id} className={`chip ${chipClass(p)}`} aria-current={!allDone && i === current} onClick={() => setCurrent(i)}>
            <span>{p.position}</span>
            <small>{chipLabel(p)}</small>
          </button>
        ))}
        <button className={`chip done-chip`} aria-current={allDone && current === home.problems.length} onClick={() => setCurrent(home.problems.length)}>
          <span>✓</span><small>Finish</small>
        </button>
      </nav>

      {current >= home.problems.length || problem === undefined
        ? <Completion home={home} />
        : <ProblemScreen
            key={problem.id}
            token={session.token}
            problem={problem}
            closed={home.status !== "open"}
            onSubmitted={() => {
              // Move on immediately; the score arrives on the chip (P8).
              const next = home.problems.findIndex((p, i) => i > current && p.submission === null)
              const firstOpen = home.problems.findIndex((p, i) => i !== current && p.submission === null)
              setCurrent(next >= 0 ? next : firstOpen >= 0 ? firstOpen : home.problems.length)
              refresh()
            }}
          />}
    </main>
  )
}

const chipClass = (p: StudentProblem) => p.submission === null ? "todo" : p.submission.state
const chipLabel = (p: StudentProblem) =>
  p.submission === null ? "to do" :
  p.submission.state === "grading" ? "checking…" :
  p.submission.state === "teacher_check" ? "teacher" :
  `${p.submission.score}/${p.maxPoints}`

function ProblemScreen(props: { readonly token: string; readonly problem: StudentProblem; readonly closed: boolean; readonly onSubmitted: () => void }) {
  const p = props.problem
  const [strokes, setStrokes] = useState<ReadonlyArray<Stroke>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onChange = useCallback((s: ReadonlyArray<Stroke>) => setStrokes(s), [])

  const submit = async () => {
    setBusy(true); setError(null)
    const png = await renderPng(strokes)
    // Same key on a retry (double-tap, flaky wifi): the server keeps one submission (P23).
    const r = await call({ student: props.token }, (c) => c.student.submit({
      payload: { problemId: p.id, idempotencyKey: drawingKey(p.id), strokes, imagePng: png }
    }))
    setBusy(false)
    if (r.ok || r.tag === "AlreadySubmitted") props.onSubmitted()
    else setError(r.tag === "HttpClientError" ? "Couldn't send it. Check your connection and press Submit again. Your drawing is still here." : friendly(r))
  }

  return (
    <section className="problem-screen">
      <h2 className="problem-text"><span className="muted">Problem {p.position}.</span> <MathText text={p.prompt} /></h2>
      {p.submission !== null ? (
        <Submitted problem={p} />
      ) : (
        <>
          <Whiteboard height={360} onChange={onChange} />
          <div className="actions">
            <button className="primary big" disabled={strokes.length === 0 || busy || props.closed} onClick={submit}>
              {busy ? "Sending…" : "Submit and continue →"}
            </button>
            <span className="muted small">Show your work. You get one try per problem.</span>
          </div>
          {props.closed && <p className="notice">This assignment is closed.</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}
    </section>
  )
}

/** Task-framed, never ego-framed (D-01, Butler): what the work did, not a rank. */
function Submitted(props: { readonly problem: StudentProblem }) {
  const s = props.problem.submission!
  if (s.state === "grading") return <p className="submitted">Submitted ✓. Checking your work… Keep going, your score will appear here.</p>
  if (s.state === "teacher_check") return <p className="submitted">Submitted ✓. Your teacher will check this one.</p>
  return (
    <div className="submitted">
      <p className="score">{s.score} / {props.problem.maxPoints}</p>
      {s.metLabels.length > 0 && <ul className="met">{s.metLabels.map((l) => <li key={l}>✓ {l}</li>)}</ul>}
    </div>
  )
}

function Completion(props: { readonly home: StudentHome }) {
  const left = props.home.problems.filter((p) => p.submission === null)
  if (left.length > 0) {
    return (
      <section className="completion">
        <h2>Almost there</h2>
        <p>You still have {left.length === 1 ? "problem" : "problems"} {left.map((p) => p.position).join(", ")} to do.</p>
      </section>
    )
  }
  return (
    <section className="completion">
      <h2>All done! 🎉</h2>
      <p>Nice work showing your thinking. Scores appear as they're checked, and your teacher may adjust them.</p>
      <ul className="summary">
        {props.home.problems.map((p) => <li key={p.id}>Problem {p.position}: {chipLabel(p)}</li>)}
      </ul>
      <a className="button primary big" href={GOBLINS_URL} target="_blank" rel="noreferrer">Keep practicing with Goblins →</a>
    </section>
  )
}
