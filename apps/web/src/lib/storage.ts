/**
 * Per-browser conveniences only (P7): everything durable lives in Postgres.
 * localStorage can be unavailable (private mode, blocked storage), so every
 * access is guarded and the app still works, just without remembering.
 */
const get = (key: string): string | null => {
  try { return localStorage.getItem(key) } catch { return null }
}
const set = (key: string, value: string | null) => {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* not remembered */ }
}

const TEACHER = "ag.teacher"
const STUDENT = "ag.student"

/** The teacher's capability secret: from the link's #k= fragment, else remembered (D-04). */
export const teacherSecret = {
  read: (): string | null => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("k")
    if (fromHash) set(TEACHER, fromHash)
    return fromHash ?? get(TEACHER)
  },
  save: (secret: string) => set(TEACHER, secret),
  forget: () => set(TEACHER, null)
}

export const teacherLink = (secret: string) => `${window.location.origin}/t#k=${secret}`

export interface StudentSession {
  readonly token: string
  readonly rejoinCode: string
  readonly classCode: string
  readonly displayName: string
}

export const studentSession = {
  read: (): StudentSession | null => {
    const raw = get(STUDENT)
    if (raw === null) return null
    try { return JSON.parse(raw) as StudentSession } catch { return null }
  },
  save: (s: StudentSession) => set(STUDENT, JSON.stringify(s)),
  forget: () => set(STUDENT, null)
}

/**
 * A stable idempotency key per (student, problem): a retried submit can't
 * double-submit (P23). Scoped by student so a second student on a shared
 * Chromebook never reuses the first one's key.
 */
export const drawingKey = (studentId: string, problemId: string) => {
  const k = `ag.key.${studentId}.${problemId}`
  const existing = get(k)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  set(k, fresh)
  return fresh
}

/**
 * Unsubmitted work, per (student, problem), so a refresh or a look at another
 * problem never loses it. Browser-only: a different device starts blank.
 */
export const drafts = {
  read: <A>(studentId: string, problemId: string, decode: (raw: unknown) => A | null): A | null => {
    const raw = get(`ag.draft.${studentId}.${problemId}`)
    if (raw === null) return null
    try { return decode(JSON.parse(raw)) } catch { return null }
  },
  save: (studentId: string, problemId: string, value: unknown) => {
    let json: string | null = null
    try { json = JSON.stringify(value) } catch { return }
    set(`ag.draft.${studentId}.${problemId}`, json)
  },
  clear: (studentId: string, problemId: string) => {
    set(`ag.draft.${studentId}.${problemId}`, null)
    set(`ag.key.${studentId}.${problemId}`, null)
  }
}
