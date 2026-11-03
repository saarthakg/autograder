import type { AssignmentSummary } from "@autograder/domain"
import { useEffect, useState } from "react"
import { call, friendly } from "../api.ts"
import { navigate } from "../lib/router.ts"
import { teacherLink } from "../lib/storage.ts"
import { CopyButton } from "./CopyButton.tsx"

/** The teacher's home: their capability link (the only way back) and their assignments (D-04). */
export function TeacherHome(props: { readonly secret: string }) {
  const [items, setItems] = useState<ReadonlyArray<AssignmentSummary> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call({ teacher: props.secret }, (c) => c.teacher.listAssignments()).then((r) =>
      r.ok ? setItems(r.value) : setError(r.tag === "Unauthorized" ? "This teacher link isn't valid." : friendly(r)))
  }, [props.secret])

  return (
    <main className="page">
      <header className="page-head">
        <h1>Your assignments</h1>
        <button className="primary" onClick={() => navigate("/t/new")}>New assignment</button>
      </header>
      <WorkspaceLink secret={props.secret} />
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">No assignments yet. Create one, or start from the sample on the home page.</p>}
      <ul className="card-list">
        {items?.map((a) => (
          <li key={a.id}>
            <button className="card" onClick={() => navigate(`/t/a/${a.id}`)}>
              <span className="card-title">{a.title}</span>
              <span className={`pill ${a.status}`}>{a.status === "open" ? `Open · ${a.classCode}` : a.status}</span>
              <span className="muted">
                {a.problemCount} problems · {a.studentCount} students · {a.gradedCount} graded
                {a.reviewCount > 0 ? ` · ${a.reviewCount} to check` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

/** Shown prominently: anyone with this link has access; it's also how you get back on another device (D-04). */
export function WorkspaceLink(props: { readonly secret: string }) {
  const link = teacherLink(props.secret)
  return (
    <aside className="workspace-link">
      <div>
        <strong>Your private teacher link</strong>
        <p className="muted small">Bookmark it or email it to yourself. It's how you get back here from any device. Anyone with it can see your class.</p>
      </div>
      <code>{link}</code>
      <CopyButton text={link} label="Copy link" />
      <a className="button" href={`mailto:?subject=${encodeURIComponent("My auto-grader link")}&body=${encodeURIComponent(link)}`}>Email it</a>
    </aside>
  )
}
