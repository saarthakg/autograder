import { useState } from "react"
import { call, friendly } from "../api.ts"
import { navigate } from "../lib/router.ts"
import { studentSession } from "../lib/storage.ts"

/** Class code + first name, nothing else (P2). Rejoin restores the same student on any device. */
export function Join() {
  const params = new URLSearchParams(window.location.search)
  const [code, setCode] = useState(params.get("code") ?? "")
  const [name, setName] = useState("")
  const [rejoinCode, setRejoinCode] = useState("")
  const [mode, setMode] = useState<"join" | "rejoin">("join")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setError(null)
    const r = mode === "join"
      ? await call({}, (c) => c.public.join({ payload: { classCode: code, displayName: name } }))
      : await call({}, (c) => c.public.rejoin({ payload: { classCode: code, rejoinCode } }))
    setBusy(false)
    if (!r.ok) {
      setError(r.tag === "NotFound" ? (mode === "join" ? "We couldn't find that class code. Check it with your teacher." : "Those codes don't match. Check both with your teacher.")
        : r.tag === "AssignmentNotOpen" ? "This assignment isn't open right now."
        : r.tag === "NameTaken" ? `Someone named ${(r.error as { displayName: string }).displayName} already joined. If that's you, use your rejoin code below. If not, add your last initial (like "${name.trim()} K").`
        : friendly(r))
      return
    }
    studentSession.save({ token: r.value.token, rejoinCode: r.value.rejoinCode, classCode: code.toUpperCase().replace(/[\s-]/g, ""), displayName: r.value.displayName })
    navigate("/s")
  }

  return (
    <main className="page narrow join">
      <h1>{mode === "join" ? "Join your class" : "Welcome back"}</h1>
      <label className="field">
        <span>Class code</span>
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="AB3K9X" maxLength={12} />
      </label>
      {mode === "join" ? (
        <label className="field">
          <span>Your first name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} />
        </label>
      ) : (
        <label className="field">
          <span>Your rejoin code</span>
          <input className="code-input" value={rejoinCode} onChange={(e) => setRejoinCode(e.target.value)} autoCapitalize="characters" autoComplete="off" maxLength={8} />
        </label>
      )}
      <button className="primary big" disabled={busy || code.trim().length < 4 || (mode === "join" ? name.trim() === "" : rejoinCode.trim() === "")} onClick={go}>
        {busy ? "Joining…" : mode === "join" ? "Join" : "Get back in"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="link" onClick={() => { setMode(mode === "join" ? "rejoin" : "join"); setError(null) }}>
        {mode === "join" ? "Already joined on another device? Use your rejoin code" : "New here? Join with your name"}
      </button>
    </main>
  )
}
