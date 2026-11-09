import { useState } from "react"
import { call, friendly } from "./api.ts"
import { navigate } from "./lib/router.ts"
import { teacherSecret } from "./lib/storage.ts"

/** Gets (or silently creates) the teacher's workspace secret: no signup wall. */
export const ensureWorkspace = async (): Promise<string | null> => {
  const existing = teacherSecret.read()
  if (existing) return existing
  const r = await call({}, (c) => c.public.createWorkspace())
  if (!r.ok) return null
  teacherSecret.save(r.value.secret)
  return r.value.secret
}

export function Landing() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trySample = async () => {
    setBusy(true); setError(null)
    const secret = await ensureWorkspace()
    if (!secret) { setBusy(false); setError("Couldn't start a workspace. Try again."); return }
    const r = await call({ teacher: secret }, (c) => c.teacher.createSample())
    setBusy(false)
    if (r.ok) navigate(`/t/a/${r.value.id}`)
    else setError(friendly(r))
  }

  return (
    <main className="landing">
      <section className="hero">
        <p className="eyebrow">Free for teachers</p>
        <h1>Grade a whole class's math in minutes.</h1>
        <p className="lede">
          Students show their work on a whiteboard. Each answer is scored against a rubric you can edit,
          and you see what the class needs before tomorrow's lesson. No account, no roster.
        </p>
        <div className="hero-actions">
          <button className="primary big" onClick={trySample} disabled={busy}>
            {busy ? "Setting up…" : "Try a sample assignment"}
          </button>
          <button className="big" onClick={() => navigate("/t/new")}>Create your own</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <section className="student-entry">
        <h2>Are you a student?</h2>
        <button className="big" onClick={() => navigate("/join")}>Enter your class code</button>
      </section>
      <ul className="how">
        <li><strong>1.</strong> Type your problems. A rubric is drafted for each one, and you can edit it.</li>
        <li><strong>2.</strong> Share the class code. Students join with just their first name.</li>
        <li><strong>3.</strong> Scores arrive as students work. You review only what's flagged.</li>
      </ul>
    </main>
  )
}
