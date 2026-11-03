import type { TemplateView } from "@autograder/domain"
import { useEffect, useState } from "react"
import { call, friendly } from "./api.ts"
import { MathText } from "./components/Math.tsx"
import { ensureWorkspace } from "./Landing.tsx"
import { navigate } from "./lib/router.ts"

/** A colleague's shared assignment (P10): preview, then one click for your own copy. */
export function SharePage(props: { readonly slug: string }) {
  const [t, setT] = useState<TemplateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call({}, (c) => c.public.getTemplate({ params: { slug: props.slug } })).then((r) => r.ok ? setT(r.value) : setError(r.tag === "NotFound" ? "This shared link doesn't exist." : friendly(r)))
  }, [props.slug])

  const copy = async () => {
    setBusy(true)
    const secret = await ensureWorkspace()
    const r = secret ? await call({ teacher: secret }, (c) => c.teacher.copyTemplate({ params: { slug: props.slug } })) : null
    setBusy(false)
    if (r?.ok) navigate(`/t/a/${r.value.id}`)
    else setError(r ? friendly(r) : "Couldn't start a workspace.")
  }

  if (error) return <main className="page narrow"><p className="error">{error}</p></main>
  if (t === null) return <main className="page narrow"><p className="muted">Loading…</p></main>
  return (
    <main className="page narrow">
      <p className="eyebrow">A colleague shared this with you</p>
      <h1>{t.title}</h1>
      <ol className="template-problems">
        {t.problems.map((p, i) => (
          <li key={i}><MathText text={p.prompt} /> <span className="muted small">· {p.maxPoints} pts · {p.rubric.items.length} criteria</span></li>
        ))}
      </ol>
      <button className="primary big" disabled={busy} onClick={copy}>{busy ? "Copying…" : "Use it with my class"}</button>
      <p className="muted small">You get your own copy with your own class code. No account needed.</p>
    </main>
  )
}
