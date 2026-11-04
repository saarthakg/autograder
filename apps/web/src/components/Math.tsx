import { useEffect, useState } from "react"

type Katex = typeof import("katex")
let katexPromise: Promise<Katex> | null = null
// Loaded on first use, so a Chromebook doesn't pay for it before a problem is on screen.
const loadKatex = () => (katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k))

/** Renders text with inline $...$ math. Falls back to the raw text until KaTeX loads. */
export function MathText(props: { readonly text: string; readonly className?: string }) {
  const [katex, setKatex] = useState<Katex | null>(null)
  useEffect(() => {
    if (props.text.includes("$")) loadKatex().then(setKatex, () => undefined)
  }, [props.text])
  const parts = props.text.split(/(?<!\\)\$(.+?)(?<!\\)\$/g)
  return (
    <span className={props.className}>
      {parts.map((part, i) => {
        const text = part.replace(/\\\$/g, "$")
        if (i % 2 === 0) return <span key={i}>{text}</span>
        if (katex === null) return <span key={i}>{text}</span>
        return <span key={i} dangerouslySetInnerHTML={{ __html: katex.default.renderToString(part, { throwOnError: false }) }} />
      })}
    </span>
  )
}
