import { Data, Effect, FileSystem, Path } from "effect"

/**
 * Versioned prompts loaded from `prompts/<name>.<version>.md`. Every
 * grade records the prompt id it used, e.g. "grade.v1".
 */
export interface PromptTemplate {
  readonly id: string
  readonly system: string
  readonly user: string
}

class PromptError extends Data.TaggedError("PromptError")<{ readonly message: string }> {}

export const parsePrompt = (id: string, text: string): PromptTemplate => {
  const body = text.replace(/<!--[\s\S]*?-->/g, "")
  const match = body.match(/## system\n([\s\S]*?)\n## user\n([\s\S]*)$/)
  if (match === null) throw new Error(`prompt ${id} must have "## system" then "## user" sections`)
  return { id, system: match[1]!.trim(), user: match[2]!.trim() }
}

/** Fills {{placeholders}}. A missing or unused variable is a bug, so it fails loudly. */
export const render = (template: string, vars: Readonly<Record<string, string>>): string => {
  const used = new Set<string>()
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key]
    if (value === undefined) throw new Error(`prompt variable {{${key}}} has no value`)
    used.add(key)
    return value
  })
  const unused = Object.keys(vars).filter((k) => !used.has(k))
  if (unused.length > 0) throw new Error(`prompt variables never used: ${unused.join(", ")}`)
  return out
}

export const loadPrompt = (directory: string, id: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(directory, `${id}.md`))
    return yield* Effect.try({ try: () => parsePrompt(id, text), catch: (e) => new PromptError({ message: String(e) }) })
  }).pipe(Effect.mapError((e) => e._tag === "PromptError" ? e : new PromptError({ message: `cannot read prompt ${id}: ${e.message}` })))
