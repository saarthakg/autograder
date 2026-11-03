import { useState } from "react"

export function CopyButton(props: { readonly text: string; readonly label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(props.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined)}
    >
      {copied ? "Copied ✓" : props.label}
    </button>
  )
}
