import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parsePrompt, render } from "../src/grading/Prompts.ts"

const read = (id: string) => readFileSync(fileURLToPath(new URL(`../../../prompts/${id}.md`, import.meta.url)), "utf8")

describe("prompts", () => {
  it("parses both shipped prompts into system and user sections", () => {
    for (const id of ["grade.v1", "rubric.v1"]) {
      const p = parsePrompt(id, read(id))
      expect(p.system.length).toBeGreaterThan(100)
      expect(p.user).toContain("{{problem}}")
      expect(p.system).not.toContain("<!--")
    }
  })

  it("render fails loudly on missing or unused variables", () => {
    expect(render("a {{x}} b", { x: "1" })).toBe("a 1 b")
    expect(() => render("a {{x}}", {})).toThrow("{{x}}")
    expect(() => render("a", { y: "1" })).toThrow("never used: y")
  })
})
