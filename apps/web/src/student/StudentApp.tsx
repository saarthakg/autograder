import { Stroke, StudentHome, StudentProblem } from "@autograder/domain"
import { Schema } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { call, friendly } from "../api.ts"
import { MathText } from "../components/Math.tsx"
import { StrokeView } from "../components/StrokeView.tsx"
import { navigate } from "../lib/router.ts"
import { drafts, drawingKey, type StudentSession, studentSession } from "../lib/storage.ts"
import { usePoll } from "../lib/usePoll.ts"
import { scoreBand } from "../lib/score.ts"
import { renderPng } from "../whiteboard/ink.ts"
import { Whiteboard } from "../whiteboard/Whiteboard.tsx"

const GOBLINS_URL = "https://goblinsapp.com"

/**
 * The student's assignment. Submit never waits on the grader (P8): it returns
 * at once and "Next problem" works immediately. If the student stays, the
 * score fills in next to their work; it also appears on that problem's chip.
 */
export function StudentApp() {
  const [session] = useState<StudentSession | null>(() => studentSession.read())
  const [home, setHome] = useState<StudentHome | null>(null)
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // On first load (join, rejoin, return visit), open the first unfinished problem, or the summary.
  const positioned = useRef(false)
  const refresh = useCallback(async () => {
    if (!session) return
    const r = await call({ student: session.token }, (c) => c.student.home())
    if (r.ok && !positioned.current) {
      positioned.current = true
      const open = r.value.problems.findIndex((p) => p.submission === null)
      setCurrent(open >= 0 ? open : r.value.problems.length)
    }
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
        <span className="muted small">
          To continue on another device: class code <strong className="mono">{home.classCode}</strong> + rejoin code <strong className="mono">{home.rejoinCode}</strong>
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
            studentId={home.studentId}
            problem={problem}
            closed={home.status !== "open"}
            onSubmitted={(strokes) => {
              // Show "Grading…" at once (no flash of the old state), then fetch the real state.
              setHome((h) => h && markSubmitted(h, problem.id, strokes))
              refresh()
            }}
            onNext={() => {
              const next = home.problems.findIndex((p, i) => i > current && p.submission === null)
              const firstOpen = home.problems.findIndex((p, i) => i !== current && p.submission === null)
              setCurrent(next >= 0 ? next : firstOpen >= 0 ? firstOpen : home.problems.length)
            }}
            hasNext={home.problems.some((p, i) => i !== current && p.submission === null)}
          />}
    </main>
  )
}

/** Optimistic local state right after a submit: the server's answer replaces it a moment later. */
const markSubmitted = (h: StudentHome, problemId: string, strokes: ReadonlyArray<Stroke>): StudentHome =>
  new StudentHome({
    ...h,
    problems: h.problems.map((p) =>
      p.id !== problemId || p.submission !== null ? p : new StudentProblem({ ...p, submission: { state: "grading", score: null, metLabels: [], notYetLabels: [], strokes } })
    )
  })

const chipClass = (p: StudentProblem) =>
  p.submission === null ? "todo" :
  p.submission.state === "graded" && p.submission.score !== null ? `graded ${scoreBand(p.submission.score, p.maxPoints)}` :
  p.submission.state
const chipLabel = (p: StudentProblem) =>
  p.submission === null ? "to do" :
  p.submission.state === "grading" ? "checking…" :
  p.submission.state === "teacher_check" ? "teacher will check" :
  `${p.submission.score}/${p.maxPoints}`

/** About 60% of the window, never below 360 px: room for multi-line algebra on a tablet. */
const boardHeight = () => Math.min(900, Math.max(360, Math.round(window.innerHeight * 0.6)))
const useBoardHeight = () => {
  const [h, setH] = useState(boardHeight)
  useEffect(() => {
    const onResize = () => setH(boardHeight())
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return h
}

const decodeDraft = (raw: unknown) => {
  const r = Schema.decodeUnknownOption(Schema.Array(Stroke))(raw)
  return r._tag === "Some" ? r.value : null
}

function ProblemScreen(props: {
  readonly token: string
  readonly studentId: string
  readonly problem: StudentProblem
  readonly closed: boolean
  readonly onSubmitted: (strokes: ReadonlyArray<Stroke>) => void
  readonly onNext: () => void
  readonly hasNext: boolean
}) {
  const p = props.problem
  // Restore unsubmitted work for THIS student and problem (refresh, tab switch).
  const [initial] = useState(() => drafts.read(props.studentId, p.id, decodeDraft) ?? [])
  const [strokes, setStrokes] = useState<ReadonlyArray<Stroke>>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const height = useBoardHeight()
  const onChange = useCallback((s: ReadonlyArray<Stroke>) => {
    setStrokes(s)
    s.length === 0 ? drafts.clear(props.studentId, p.id) : drafts.save(props.studentId, p.id, s)
  }, [props.studentId, p.id])

  const submit = async () => {
    setBusy(true); setError(null)
    const png = await renderPng(strokes)
    // Same key on a retry (double-tap, flaky wifi): the server keeps one submission (P23).
    const r = await call({ student: props.token }, (c) => c.student.submit({
      payload: { problemId: p.id, idempotencyKey: drawingKey(props.studentId, p.id), strokes, imagePng: png }
    }))
    setBusy(false)
    if (r.ok || r.tag === "AlreadySubmitted") { drafts.clear(props.studentId, p.id); props.onSubmitted(strokes) }
    else setError(r.tag === "HttpClientError" ? "Couldn't send it. Check your connection and press Submit again. Your drawing is still here." : friendly(r))
  }

  return (
    <section className="problem-screen">
      <h2 className="problem-text"><span className="muted">Problem {p.position}.</span> <MathText text={p.prompt} /></h2>
      {p.submission !== null ? (
        <Submitted problem={p} onNext={props.onNext} hasNext={props.hasNext} />
      ) : (
        <>
          <Whiteboard height={height} initial={initial} onChange={onChange} />
          <div className="actions">
            <button className="primary big" disabled={strokes.length === 0 || busy || props.closed} onClick={submit}>
              {busy ? "Sending…" : "Submit"}
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

/**
 * The score moment: the student's own work beside its score. Task-framed,
 * never ego-framed (D-01, Butler): what the work did, not a rank, and "Not
 * yet" in neutral ink, never red. "Next" never waits on the grader (P8).
 */
function Submitted(props: { readonly problem: StudentProblem; readonly onNext: () => void; readonly hasNext: boolean }) {
  const s = props.problem.submission!
  return (
    <div className="submitted">
      <div className="score-moment">
        <StrokeView strokes={s.strokes} width={320} height={180} />
        <div className="score-side" aria-live="polite">
          {s.state === "grading" && <><p className="submitted-label">Submitted ✓</p><p className="muted">Grading…</p></>}
          {s.state === "teacher_check" && <><p className="submitted-label">Submitted ✓</p><p>Your teacher will check this one.</p></>}
          {s.state === "graded" && (
            <>
              <p className="score">{s.score} / {props.problem.maxPoints}</p>
              {s.metLabels.length > 0 && <ul className="met">{s.metLabels.map((l) => <li key={l}>✓ {l}</li>)}</ul>}
              {s.notYetLabels.length > 0 && (
                <div className="not-yet"><span>Not yet:</span><ul>{s.notYetLabels.map((l) => <li key={l}>{l}</li>)}</ul></div>
              )}
            </>
          )}
        </div>
      </div>
      <button className="primary big" onClick={props.onNext}>{props.hasNext ? "Next problem →" : "Finish →"}</button>
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
        {props.home.problems.map((p) => (
          <li key={p.id}>Problem {p.position}: {p.submission?.state === "teacher_check" ? "your teacher will check this one" : chipLabel(p)}</li>
        ))}
      </ul>
      <a className="button primary big" href={GOBLINS_URL} target="_blank" rel="noreferrer">Keep practicing with Goblins →</a>
    </section>
  )
}
