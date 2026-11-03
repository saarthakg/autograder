import { type AssignmentDetail, type ProblemView, type Report, Rubric, RubricItem, type SubmissionDetail } from "@autograder/domain"
import { useCallback, useEffect, useState } from "react"
import { call, friendly } from "../api.ts"
import { MathText } from "../components/Math.tsx"
import { StrokeView } from "../components/StrokeView.tsx"
import { navigate } from "../lib/router.ts"
import { usePoll } from "../lib/usePoll.ts"
import { CopyButton } from "./CopyButton.tsx"
import { WorkspaceLink } from "./TeacherHome.tsx"

/** Stated assumption behind "time saved" (P10): a careful hand-grade of one problem. */
const MINUTES_PER_SUBMISSION = 1
const GOBLINS_URL = "https://goblinsapp.com"

export function AssignmentPage(props: { readonly secret: string; readonly id: string }) {
  const [a, setA] = useState<AssignmentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"report" | "rubrics">("report")
  const t = { teacher: props.secret }

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

  return (
    <main className="page">
      <nav className="crumbs"><button className="link" onClick={() => navigate("/t")}>← All assignments</button></nav>
      <header className="page-head">
        <h1>{a.title}</h1>
        {a.status === "draft" && (
          <button className="primary big" onClick={() => act((c) => c.teacher.publish({ params: { id: a.id } }))}>Publish and get a class code</button>
        )}
      </header>

      {a.status === "draft" ? (
        <>
          <p className="lede">Check each rubric. These are the criteria every answer is scored against. Edit anything, then publish.</p>
          {a.rubricFallbacks.length > 0 && (
            <p className="notice">We couldn't draft a rubric for {a.rubricFallbacks.length === 1 ? "one problem" : `${a.rubricFallbacks.length} problems`}, so there's a simple starter. Please fill it in.</p>
          )}
          {a.problems.map((p) => <RubricEditor key={p.id} secret={props.secret} problem={p} onSaved={load} />)}
        </>
      ) : (
        <>
          <ClassCodeBanner a={a} />
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>Class report</button>
            <button role="tab" aria-selected={tab === "rubrics"} onClick={() => setTab("rubrics")}>Rubrics</button>
          </div>
          {tab === "report"
            ? <ReportView secret={props.secret} a={a} onChange={setA} />
            : a.problems.map((p) => <RubricEditor key={p.id} secret={props.secret} problem={p} onSaved={load} />)}
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
// Rubric editor (P3): text, points, add, remove, reorder; validated by the server.
// ---------------------------------------------------------------------------

interface ItemDraft { label: string; description: string; points: number }

function RubricEditor(props: { readonly secret: string; readonly problem: ProblemView; readonly onSaved: () => void }) {
  const p = props.problem
  const [items, setItems] = useState<Array<ItemDraft>>(p.rubric.items.map((i) => ({ label: i.label, description: i.description, points: i.points })))
  const [ref, setRef] = useState(p.rubric.referenceSolution)
  const [problems, setProblems] = useState<ReadonlyArray<string>>([])
  const [saved, setSaved] = useState(false)
  const sum = items.reduce((s, i) => s + i.points, 0)
  const dirty = JSON.stringify(items) !== JSON.stringify(p.rubric.items.map((i) => ({ label: i.label, description: i.description, points: i.points }))) || ref !== p.rubric.referenceSolution

  const update = (i: number, patch: Partial<ItemDraft>) => { setSaved(false); setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  const move = (i: number, d: -1 | 1) => setItems((xs) => {
    const next = [...xs]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x!); return next
  })

  const save = async () => {
    const rubric = new Rubric({
      items: items.map((x, i) => new RubricItem({ id: `c${i + 1}`, label: x.label.trim(), description: x.description.trim(), points: x.points })),
      referenceSolution: ref.trim()
    })
    const r = await call({ teacher: props.secret }, (c) => c.teacher.saveRubric({ params: { id: p.id }, payload: rubric }))
    if (r.ok) { setProblems([]); setSaved(true); props.onSaved() }
    else setProblems(r.tag === "InvalidRubric" ? (r.error as { problems: ReadonlyArray<string> }).problems : [r.tag === "SchemaError" ? "Each criterion needs a short label (60 characters max) and a description." : friendly(r)])
  }

  return (
    <section className="rubric-card">
      <header className="row-between">
        <h2>Problem {p.position}</h2>
        <span className="muted small">{p.rubricSource === "sample" ? "Reviewed sample rubric" : p.rubricSource === "generated" ? "Drafted for you: please check" : p.rubricSource === "template" ? "Starter rubric" : `Edited (v${p.rubricVersion})`}</span>
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
        <button className="primary" disabled={!dirty || sum !== p.maxPoints} onClick={save}>{saved && !dirty ? "Saved ✓" : "Save rubric"}</button>
      </div>
      {problems.length > 0 && <ul className="error small">{problems.map((m) => <li key={m}>{m}</li>)}</ul>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Report (P5, P6): "what do I do tomorrow?"
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
  // The report is live while the assignment is open: 10 s, backing off to 30 s (D-24).
  usePoll(refresh, props.a.status === "open", 10_000, 30_000)

  if (report === null) return <p className="muted">Loading the class report…</p>

  const submittedCount = report.students.reduce((n, s) => n + s.submitted, 0)
  const grading = submittedCount - report.graded - report.students.reduce((n, s) => n + s.cells.filter((c) => c.status === "needs_review").length, 0)

  const share = async () => {
    const r = await call(t, (c) => c.teacher.share({ params: { id: props.a.id } }))
    if (r.ok) setShareUrl(`${window.location.origin}/share/${r.value.slug}`)
  }
  const toggle = async (fn: "close" | "publish") => {
    const r = await call(t, (c) => fn === "close" ? c.teacher.close({ params: { id: props.a.id } }) : c.teacher.publish({ params: { id: props.a.id } }))
    if (r.ok) props.onChange(r.value)
  }
  const setShow = async (show: boolean) => {
    const r = await call(t, (c) => c.teacher.setShowCriteria({ params: { id: props.a.id }, payload: { showCriteria: show } }))
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
                  {s.cells.map((c) => (
                    <td key={c.problemId}>
                      {c.submissionId === null ? <span className="cell empty" aria-label="Not started">·</span> : (
                        <button className={`cell ${c.status}`} onClick={() => setOpen(c.submissionId)} aria-label={`${s.displayName} problem score`}>
                          {c.status === "grading" ? "…" : c.status === "needs_review" ? "⚑" : c.score}
                          {c.overridden && <span className="mark" title="You adjusted this">✎</span>}
                          {c.staleRubric && <span className="mark" title="Graded with an earlier rubric">↺</span>}
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="total">{s.total}<span className="muted small">/{s.maxPossible}</span></td>
                </tr>
              ))}
              <tr className="averages">
                <th scope="row">Class average</th>
                {report.problems.map((p) => <td key={p.id}>{p.average === null ? "–" : p.average.toFixed(1)}</td>)}
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

      <section className="actions-bar">
        <button onClick={() => downloadCsv(report)}>Export CSV for your gradebook</button>
        <label className="toggle">
          <input type="checkbox" checked={props.a.showCriteria} onChange={(e) => setShow(e.target.checked)} />
          Show students which criteria they met
        </label>
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
    ...s.cells.map((c) => c.score === null ? (c.status === "needs_review" ? "needs review" : "") : String(c.score)),
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
// One submission: work, transcription, verdicts with evidence, one-click overrides (P4).
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
            {d.reviewReason && <p className="notice small">{d.reviewReason === "illegible" ? "The grader couldn't read this confidently. Your call." : "Automatic grading didn't finish. Please grade by hand."}</p>}
            {d.transcription && (
              <details open>
                <summary className="small">What the grader read</summary>
                <pre className="transcription">{d.transcription}</pre>
              </details>
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
            <p className="score-line">Score: <strong>{d.score === null ? "–" : d.score}</strong> / {d.maxPoints}{d.model && <span className="muted small"> · graded by {d.model}</span>}</p>
          </>
        )}
      </aside>
    </div>
  )
}
