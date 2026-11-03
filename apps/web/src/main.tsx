import { Effect } from "effect"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { fetchHealth } from "./api.ts"
import "./styles.css"

type Status = { readonly kind: "loading" } | { readonly kind: "ok"; readonly version: string } | { readonly kind: "down" }

function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" })
  useEffect(() => {
    Effect.runPromise(fetchHealth).then(
      (h) => setStatus({ kind: "ok", version: h.version }),
      () => setStatus({ kind: "down" })
    )
  }, [])
  return (
    <main className="shell">
      <h1>Goblins Auto-Grader</h1>
      <p className="lede">Grade a whole class's math work in minutes, with the rubric in your hands.</p>
      <p className="status" data-kind={status.kind}>
        {status.kind === "loading" && "Connecting…"}
        {status.kind === "ok" && `Server online · ${status.version}`}
        {status.kind === "down" && "Server unreachable"}
      </p>
    </main>
  )
}

const root = document.getElementById("root")
if (root === null) throw new Error("missing #root")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
