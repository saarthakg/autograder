import { type AssignmentDetail, type ProblemView, type Report, Rubric, RubricItem, type StudentView, type SubmissionDetail } from "@autograder/domain"
import { useCallback, useEffect, useRef, useState } from "react"
import { call, friendly } from "../api.ts"
import { MathText } from "../components/Math.tsx"
import { StrokeView } from "../components/StrokeView.tsx"
import { navigate } from "../lib/router.ts"
import { scoreBand } from "../lib/score.ts"
import { usePoll } from "../lib/usePoll.ts"
import { CopyButton } from "./CopyButton.tsx"
import { WorkspaceLink } from "./TeacherHome.tsx"

/** Stated assumption behind "time saved": a careful hand-grade of one problem. */
const MINUTES_PER_SUBMISSION = 1
const GOBLINS_URL = "https://goblinsapp.com"

export function AssignmentPage(props: { readonly secret: string; readonly id: string }) {
  const [a, setA] = useState<AssignmentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"report" | "rubrics">("report")
  const [blocked, setBlocked] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const t = { teacher: props.secret }

  // Unsaved rubric edits are never dropped silently (publish, leave, reload).
  const editors = useRef(new Map<string, EditorHandle>())
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const register = useCallback((id: string, h: EditorHandle | null) => { h ? editors.current.set(id, h) : editors.current.delete(id) }, [])
  const onDirty = useCallback((id: string, d: boolean) => setDirty((s) => {
    if (s.has(id) === d) return s
    const next = new Set(s); d ? next.add(id) : next.delete(id); return next
  }), [])
  useEffect(() => {
    if (dirty.size === 0) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  /** Saves every edited rubric; false (with a message) if one can't be saved. */
  const saveAll = async (): Promise<boolean> => {
    const pending = [...dirty].map((id) => editors.current.get(id)).filter((h) => h !== undefined)
    const invalid = pending.filter((h) => !h.valid())
    if (invalid.length > 0) {
      setBlocked(`Problem ${invalid.map((h) => h.position).join(", ")}: the criteria must add up to the problem's points. Fix or undo that edit first.`)
      return false
    }
    for (const h of pending) {
      if (!(await h.save())) { setBlocked(`Couldn't save the rubric for problem ${h.position}. See the message under it.`); return false }
    }
    setBlocked(null)
    return true
  }

  const load = useCallback(async () => {
    const r = await call(t, (c) => c.teacher.getAssignment({ params: { id: props.id } }))
    r.ok ? setA(r.value) : setError(r.tag === "NotFound" ? "Assignment not found for this teacher link." : friendly(r))
  }, [props.id, props.secret])
  useEffect(() => { load() }, [load])

  if (error) return <main className="page"><p className="error">{error}</p></main>
  if (a === null) return <main className="page"><p className="muted">Loading…</p></main>

  const act = async (f: Parameters<typeof call<AssignmentDetail, unknown>>[1]) => {
    const r = await call(t, f)
    r.ok ? setA(r.value) : setError(friendly(r))
  }

  const publish = async () => {
    if (dirty.size > 0 && !(await saveAll())) return
    await act((c) => c.teacher.publish({ params: { id: a.id } }))
  }
  const editorProps = { secret: props.secret, onSaved: load, register, onDirty }

  return (
    <main className="page">
      <nav className="crumbs"><button className="link" onClick={() => dirty.size > 0 ? setLeaving(true) : navigate("/t")}>← All assignments</button></nav>
      {leaving && (
        <div className="notice row-between" role="alert">
          <span>You have unsaved rubric changes.</span>
          <span className="row">
            <button className="primary" onClick={async () => { if (await saveAll()) navigate("/t"); else setLeaving(false) }}>Save and leave</button>
            <button onClick={() => navigate("/t")}>Leave without saving</button>
            <button className="link" onClick={() => setLeaving(false)}>Stay</button>
          </span>
        </div>
      )}
      <header className="page-head">
        <h1>{a.title}</h1>
        {a.status === "draft" && (
          <button className="primary big" onClick={publish}>{dirty.size > 0 ? "Save changes and publish" : "Publish and get a class code"}</button>
        )}
      </header>
      {blocked && <p className="error" role="alert">{blocked}</p>}

      {a.status === "draft" ? (
        <>
          <p className="lede">
            {a.problems.length} problem{a.problems.length === 1 ? "" : "s"}, {a.problems.reduce((n, p) => n + p.maxPoints, 0)} points in all.
            Each answer is scored on the criteria under its problem. Open a rubric to change it, or publish as is.
          </p>
          {a.rubricFallbacks.length > 0 && (
            <p className="notice">We couldn't draft a rubric for {a.rubricFallbacks.length === 1 ? "one problem" : `${a.rubricFallbacks.length} problems`}, so there's a simple starter. Please fill it in.</p>
          )}
          {a.problems.map((p) => <RubricEditor key={p.id} problem={p} {...editorProps} />)}
        </>
      ) : (
        <>
          <ClassCodeBanner a={a} />
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>Class report</button>
            <button role="tab" aria-selected={tab === "rubrics"} onClick={() => setTab("rubrics")}>Rubrics</button>
          </div>
          {tab === "report" && <ReportView secret={props.secret} a={a} onChange={setA} />}
          {/* Kept mounted while hidden, so switching tabs never discards an edit. */}
          <div hidden={tab !== "rubrics"}>
            {a.problems.map((p) => <RubricEditor key={p.id} problem={p} {...editorProps} />)}
          </div>
        </>
      )}
      <WorkspaceLink secret={props.secret} />
    </main>
  )
}

function ClassCodeBanner(props: { readonly a: AssignmentDetail }) {
  const joinUrl = `${window.location.origin}/join?code=${props.a.classCode}`
  return (
    <section className={`class-code ${props.a.status}`}>
      <div>
        <p className="muted small">Students go to <strong>{window.location.host}/join</strong> and enter</p>
        <p className="code" aria-label="Class code">{props.a.classCode}</p>
      </div>
      <div className="stack">
        <CopyButton text={joinUrl} label="Copy student link" />
        {props.a.status === "closed" && <span className="pill closed">Closed: not accepting work</span>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Rubric editor: text, points, add, remove, reorder; validated by the server.
// ---------------------------------------------------------------------------

interface ItemDraft { label: string; description: string; points: number }

interface EditorHandle {
  readonly position: number
  readonly valid: () => boolean
  readonly save: () => Promise<boolean>
}

function RubricEditor(props: {
  readonly secret: string
  readonly problem: ProblemView
  readonly onSaved: () => void
  readonly register: (id: string, h: EditorHandle | null) => void
  readonly onDirty: (id: string, dirty: boolean) => void
}) {
  const p = props.problem
  const [items, setItems] = useState<Array<ItemDraft>>(p.rubric.items.map((i) => ({ label: i.label, description: i.description, points: i.points })))
  const [ref, setRef] = useState(p.rubric.referenceSolution)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const [saved, setSaved] = useState(false)
  const sum = items.reduce((s, i) => s + i.points, 0)
  // Collapsed to a read-only summary until the teacher asks to edit; a starter template opens ready to fill in.
  const [editing, setEditing] = useState(p.rubricSource === "template")
  const dirty = JSON.stringify(items) !== JSON.stringify(p.rubric.items.map((i) => ({ label: i.label, description: i.description, points: i.points }))) || ref !== p.rubric.referenceSolution

  const update = (i: number, patch: Partial<ItemDraft>) => { setSaved(false); setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  const move = (i: number, d: -1 | 1) => setItems((xs) => {
    const next = [...xs]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x!); return next
  })

  const save = async (): Promise<boolean> => {
    const rubric = new Rubric({
      items: items.map((x, i) => new RubricItem({ id: `c${i + 1}`, label: x.label.trim(), description: x.description.trim(), points: x.points })),
      referenceSolution: ref.trim()
    })
    const r = await call({ teacher: props.secret }, (c) => c.teacher.saveRubric({ params: { id: p.id }, payload: rubric }))
    if (r.ok) { setProblems([]); setSaved(true); props.onSaved(); return true }
    setProblems(r.tag === "InvalidRubric" ? (r.error as { problems: ReadonlyArray<string> }).problems : [r.tag === "SchemaError" ? "Each criterion needs a short label (60 characters max) and a description." : friendly(r)])
    return false
  }

  // Let the page publish or leave safely: it can ask whether this editor is valid and save it.
  const latest = useRef({ save, valid: () => sum === p.maxPoints })
  latest.current = { save, valid: () => sum === p.maxPoints }
  const { register, onDirty } = props
  useEffect(() => {
    register(p.id, { position: p.position, valid: () => latest.current.valid(), save: () => latest.current.save() })
    return () => register(p.id, null)
  }, [register, p.id, p.position])
  useEffect(() => { onDirty(p.id, dirty) }, [onDirty, p.id, dirty])
  useEffect(() => () => onDirty(p.id, false), [onDirty, p.id])

  const source = p.rubricSource === "sample" ? "Reviewed sample rubric" : p.rubricSource === "generated" ? "Drafted for you" : p.rubricSource === "template" ? "Starter rubric: please fill in" : `Edited (v${p.rubricVersion})`

  if (!editing && !dirty) {
    return (
      <section className="rubric-card collapsed">
        <header className="row-between">
          <h2>Problem {p.position} <span className="muted small">· {p.maxPoints} pt{p.maxPoints === 1 ? "" : "s"}</span></h2>
          <span className="row">
            <span className="muted small">{source}</span>
            <button onClick={() => setEditing(true)}>Edit rubric</button>
          </span>
        </header>
        <p className="problem-text"><MathText text={p.prompt} /></p>
        {p.answerKey && <p className="muted small">Answer: {p.answerKey}</p>}
        <ul className="criteria-summary">
          {items.map((x, i) => <li key={i}><span>{x.label}</span><span className="muted small">{x.points} pt{x.points === 1 ? "" : "s"}</span></li>)}
        </ul>
      </section>
    )
  }

  return (
    <section className="rubric-card">
      <header className="row-between">
        <h2>Problem {p.position}</h2>
        <span className="row">
          <span className="muted small">{source}</span>
          {!dirty && <button className="link" onClick={() => setEditing(false)}>Done</button>}
        </span>
      </header>
      <p className="problem-text"><MathText text={p.prompt} /></p>
      {p.answerKey && <p className="muted small">Answer: {p.answerKey}</p>}
      <ol className="criteria-edit">
        {items.map((x, i) => (
          <li key={i}>
            <div className="criterion-fields">
              <input aria-label="What a student did (shown to them when met)" value={x.label} maxLength={60} onChange={(e) => update(i, { label: e.target.value })} placeholder="e.g. Flips the inequality" />
              <textarea aria-label="What earns it" rows={2} value={x.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="What earns this point" />
            </div>
            <select aria-label="Points" value={x.points} onChange={(e) => update(i, { points: Number(e.target.value) })}>
              {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n} pt{n > 1 ? "s" : ""}</option>)}
            </select>
            <div className="criterion-tools">
              <button className="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="icon" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="icon" aria-label="Remove" disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      {items.length < 6 && <button className="link" onClick={() => setItems((xs) => [...xs, { label: "", description: "", points: 1 }])}>+ Add a criterion</button>}
      <label className="field">
        <span>Reference solution</span>
        <textarea rows={3} value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>
      <div className="row-between">
        <span className={sum === p.maxPoints ? "ok small" : "error small"}>Points: {sum} of {p.maxPoints}</span>
        <span className="row">
          {dirty && <span className="pill warn">Unsaved changes</span>}
          <button className="primary" disabled={!dirty || sum !== p.maxPoints} onClick={save}>{saved && !dirty ? "Saved ✓" : "Save rubric"}</button>
        </span>
      </div>
      {sum !== p.maxPoints && (
        <p className="small hint">
          The criteria must add up to {p.maxPoints} point{p.maxPoints === 1 ? "" : "s"}, the problem's total.
          {sum > p.maxPoints ? ` Take ${sum - p.maxPoints} off somewhere` : ` Add ${p.maxPoints - sum} somewhere`} to save.
        </p>
      )}
      {problems.length > 0 && <ul className="error small">{problems.map((m) => <li key={m}>{m}</li>)}</ul>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Report: "what do I do tomorrow?"
// ---------------------------------------------------------------------------

function ReportView(props: { readonly secret: string; readonly a: AssignmentDetail; readonly onChange: (a: AssignmentDetail) => void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const t = { teacher: props.secret }

  const refresh = useCallback(async () => {
    const r = await call(t, (c) => c.teacher.report({ params: { id: props.a.id } }))
    if (r.ok) setReport(r.value)
  }, [props.a.id, props.secret])
  useEffect(() => { refresh() }, [refresh])
  // The report is live while the assignment is open: 10 s, backing off to 30 s.
  usePoll(refresh, props.a.status === "open", 10_000, 30_000)

  if (report === null) return <p className="muted">Loading the class report…</p>

  const submittedCount = report.students.reduce((n, s) => n + s.submitted, 0)
  const grading = submittedCount - report.graded - report.students.reduce((n, s) => n + s.cells.filter((c) => c.status === "needs_review" || c.status === "rewriting").length, 0)

  const share = async () => {
    const r = await call(t, (c) => c.teacher.share({ params: { id: props.a.id } }))
    if (r.ok) setShareUrl(`${window.location.origin}/share/${r.value.slug}`)
  }
  const toggle = async (fn: "close" | "publish") => {
    const r = await call(t, (c) => fn === "close" ? c.teacher.close({ params: { id: props.a.id } }) : c.teacher.publish({ params: { id: props.a.id } }))
    if (r.ok) props.onChange(r.value)
  }
  const setView = async (studentView: StudentView) => {
    const r = await call(t, (c) => c.teacher.setStudentView({ params: { id: props.a.id }, payload: { studentView } }))
    if (r.ok) props.onChange(r.value)
  }

  return (
    <div className="report">
      <section className="headline">
        <div><span className="big-number">{report.graded}</span> graded</div>
        <div><span className={`big-number ${report.worthALook > 0 ? "warn" : ""}`}>{report.worthALook}</span> worth a look</div>
        <div><span className="big-number">{grading > 0 ? grading : 0}</span> grading now</div>
        <div><span className="big-number">{report.students.length}</span> students joined</div>
        <div className="muted small time-saved">
          ≈ {report.graded * MINUTES_PER_SUBMISSION} min of grading saved
          <br />(assuming {MINUTES_PER_SUBMISSION} min per answer)
        </div>
      </section>

      {report.reviewQueue.length > 0 && (
        <section className="review-queue">
          <h2>Worth a look</h2>
          <ol>
            {report.reviewQueue.map((r) => (
              <li key={r.submissionId}>
                <button className="row-button" onClick={() => setOpen(r.submissionId)}>
                  <span>{r.studentName} · Problem {r.problemPosition}</span>
                  <span className={`pill ${r.risk >= 90 ? "danger" : "warn"}`}>{REASON[r.reason]}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="grid-wrap">
        {report.students.length === 0 ? (
          <p className="muted">No students yet. Share the class code above; this updates as they join.</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Student</th>
                {report.problems.map((p) => <th key={p.id} scope="col">P{p.position}<span className="muted small"> /{p.maxPoints}</span></th>)}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.students.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.displayName}</th>
                  {s.cells.map((c, i) => (
                    <td key={c.problemId}>
                      {c.submissionId === null ? <span className="cell empty" aria-label="Not started">·</span> : (
                        <button className={`cell ${c.status} ${c.score === null ? "" : scoreBand(c.score, report.problems[i]?.maxPoints ?? 0)}`} onClick={() => setOpen(c.submissionId)} aria-label={`${s.displayName} problem score`}>
                          {c.status === "grading" ? "…" : c.status === "needs_review" ? "⚑" : c.status === "rewriting" ? <span title="Couldn't be read; the student was asked to rewrite it">↻</span> : c.score}
                          {c.overridden && <span className="mark" title="You adjusted this">✎</span>}
                          {c.staleRubric && <span className="mark" title="Graded with an earlier rubric">↺</span>}
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="total">
                    {s.total}<span className="muted small">/{s.maxPossible}</span>
                    <TotalNote cells={s.cells} />
                  </td>
                </tr>
              ))}
              <tr className="averages">
                <th scope="row">Class average</th>
                {report.problems.map((p) => (
                  <td key={p.id}>{p.average === null ? "–" : <>{p.average.toFixed(1)}<span className="muted small"> · n={p.graded}</span></>}</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="misses">
        <h2>What the class missed</h2>
        {report.problems.map((p) => (
          <div key={p.id} className="miss-problem">
            <h3>Problem {p.position} <span className="muted small">· {p.graded} graded</span></h3>
            <ul>
              {p.criteria.map((c) => {
                const rate = c.judged === 0 ? null : c.missed / c.judged
                return (
                  <li key={c.id}>
                    <span className="miss-label">{c.label}</span>
                    <span className="bar" aria-hidden><span style={{ width: `${(rate ?? 0) * 100}%` }} /></span>
                    <span className="small">{rate === null ? "–" : `${Math.round(rate * 100)}% missed`}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="settings-row">
        <label className="field inline">
          <span>After grading, students see</span>
          <select value={props.a.studentView} onChange={(e) => setView(e.target.value as StudentView)}>
            <option value="met_not_yet">Score, what they did well, and what's not there yet</option>
            <option value="met">Score and what they did well</option>
            <option value="score">Their score only</option>
          </select>
        </label>
        <span className="muted small">Never the answer, and never red ink.</span>
      </section>

      <section className="actions-bar">
        <button onClick={() => downloadCsv(report)}>Export CSV for your gradebook</button>
        {props.a.status === "open"
          ? <button onClick={() => toggle("close")}>Close assignment</button>
          : <button onClick={() => toggle("publish")}>Reopen</button>}
        <button onClick={share}>Share with a colleague</button>
        <a className="button primary" href={GOBLINS_URL} target="_blank" rel="noreferrer">Open in Goblins →</a>
      </section>
      {shareUrl && (
        <p className="notice">
          Send this to a colleague. They get their own copy of the problems and rubrics, and never see your students: <code>{shareUrl}</code> <CopyButton text={shareUrl} label="Copy" />
        </p>
      )}

      {open && <SubmissionDrawer secret={props.secret} id={open} onClose={() => { setOpen(null); refresh() }} />}
    </div>
  )
}

/** A total isn't final while work is missing or still being scored: say so next to it. */
function TotalNote(props: { readonly cells: Report["students"][number]["cells"] }) {
  const notDone = props.cells.filter((c) => c.status === "not_started").length
  const pending = props.cells.filter((c) => c.status === "grading" || c.status === "needs_review" || c.status === "rewriting").length
  const parts = [notDone > 0 ? `${notDone} not done` : null, pending > 0 ? `${pending} pending` : null].filter((x) => x !== null)
  return parts.length === 0 ? null : <span className="total-note">{parts.join(" · ")}</span>
}

const REASON: Record<string, string> = {
  grading_failed: "Couldn't grade",
  invalid_output: "Couldn't grade",
  illegible: "Hard to read",
  low_confidence: "Unsure",
  medium_confidence: "Double-check",
  stale_rubric: "Older rubric"
}

const downloadCsv = (report: Report) => {
  const header = ["Student", "Rejoin code", ...report.problems.map((p) => `P${p.position} (/${p.maxPoints})`), "Total", "Out of"]
  const rows = report.students.map((s) => [
    s.displayName,
    s.rejoinCode,
    ...s.cells.map((c) => c.score === null ? (c.status === "needs_review" ? "needs review" : c.status === "rewriting" ? "rewriting" : "") : String(c.score)),
    String(s.total),
    String(s.maxPossible)
  ])
  const csv = [header, ...rows].map((r) => r.map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${report.title.replace(/[^\w-]+/g, "_")}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// One submission: work, transcription, verdicts with evidence, one-click overrides.
// ---------------------------------------------------------------------------

function SubmissionDrawer(props: { readonly secret: string; readonly id: string; readonly onClose: () => void }) {
  const [d, setD] = useState<SubmissionDetail | null>(null)
  const t = { teacher: props.secret }
  useEffect(() => {
    call(t, (c) => c.teacher.getSubmission({ params: { id: props.id } })).then((r) => r.ok && setD(r.value))
  }, [props.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [props.onClose])

  const set = async (criterionId: string, met: boolean) => {
    const r = await call(t, (c) => c.teacher.override({ params: { id: props.id, criterionId }, payload: { met } }))
    if (r.ok) setD(r.value)
  }
  /** Hand-grade a flagged item in one click: every criterion met, or none. */
  const setAll = async (met: boolean) => {
    for (const c of d?.criteria ?? []) if (c.met !== met) await set(c.id, met)
  }

  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <aside className="drawer" role="dialog" aria-label="Submission" onClick={(e) => e.stopPropagation()}>
        <header className="row-between">
          <h2>{d ? `${d.studentName} · Problem ${d.problem.position}` : "Loading…"}</h2>
          <button className="icon" aria-label="Close" onClick={props.onClose}>✕</button>
        </header>
        {d && (
          <>
            <p className="problem-text small"><MathText text={d.problem.prompt} /></p>
            <StrokeView strokes={d.strokes} width={520} height={260} />
            {d.status === "rewriting" && <p className="notice small">Neither grading model could read this, so the student was asked to rewrite it more clearly. It's graded automatically when they resubmit.</p>}
            {d.status !== "rewriting" && d.reviewReason && <p className="notice small">{d.reviewReason === "illegible" ? "Still unreadable after a second model and the student's rewrite. Your call." : "Automatic grading didn't finish. Please grade by hand."}</p>}
            {d.transcription && (
              <details open>
                <summary className="small">What the grader read</summary>
                <pre className="transcription">{d.transcription}</pre>
              </details>
            )}
            {d.score === null && d.status !== "grading" && d.status !== "rewriting" && (
              <div className="hand-grade row-between">
                <span className="small">Set every criterion to finish grading this one ({d.criteria.filter((c) => c.met !== null).length} of {d.criteria.length} set).</span>
                <span className="row">
                  <button onClick={() => setAll(true)}>All met</button>
                  <button onClick={() => setAll(false)}>None met</button>
                </span>
              </div>
            )}
            <ul className="verdicts">
              {d.criteria.map((c) => (
                <li key={c.id} className={c.met === true ? "met" : c.met === false ? "missed" : ""}>
                  <div>
                    <strong>{c.label}</strong> <span className="muted small">({c.points} pt{c.points > 1 ? "s" : ""})</span>
                    {c.evidence && <p className="muted small">{c.evidence}</p>}
                    {c.override !== null && c.modelMet !== null && c.override !== c.modelMet && <p className="small">✎ You changed this</p>}
                  </div>
                  <div className="seg" role="group" aria-label={`Verdict for ${c.label}`}>
                    <button aria-pressed={c.met === true} onClick={() => set(c.id, true)}>✓ Met</button>
                    <button aria-pressed={c.met === false} onClick={() => set(c.id, false)}>✗ Not yet</button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="score-line">
              Score: <strong>{d.score === null ? "–" : d.score}</strong> / {d.maxPoints}
              {d.usedFallback && <span className="pill warn" title="The main grading model was unsure or unavailable, so the stronger model graded this one.">Graded by the stronger model</span>}
            </p>
            {d.model && (
              <details className="grading-details">
                <summary className="small muted">Grading details</summary>
                <p className="small muted">Model <code>{d.model}</code>{d.provider && <> via {d.provider}</>}{d.confidence && <> · confidence {d.confidence}</>}</p>
              </details>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
