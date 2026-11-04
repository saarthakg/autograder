import { describe, expect, it } from "@effect/vitest"
import { normaliseCode, sha256, shortCode } from "../src/product/Codes.ts"
import { effective, reviewRisk, studentState } from "../src/product/Scoring.ts"

const items = [{ id: "c1", points: 1 }, { id: "c2", points: 1 }, { id: "c3", points: 2 }]
const model = [{ id: "c1", met: true, evidence: "" }, { id: "c2", met: false, evidence: "" }, { id: "c3", met: true, evidence: "" }]

describe("effective verdicts", () => {
  it("totals the model's verdicts by weight", () => {
    expect(effective(items, model, {}).score).toBe(3)
  })
  it("lets one override flip a criterion, recomputing the total in code", () => {
    const e = effective(items, model, { c2: true })
    expect(e.score).toBe(4)
    expect(e.overridden).toBe(true)
  })
  it("has no score until every criterion has a verdict", () => {
    expect(effective(items, null, { c1: true }).score).toBeNull()
    expect(effective(items, null, { c1: true, c2: false, c3: true }).score).toBe(3)
  })
})

describe("studentState (D-06: never a made-up score)", () => {
  it("shows grading, then graded; needs_review is the teacher's until fully graded by hand", () => {
    expect(studentState("queued", effective(items, null, {}))).toBe("grading")
    expect(studentState("graded", effective(items, model, {}))).toBe("graded")
    expect(studentState("needs_review", effective(items, null, {}))).toBe("teacher_check")
    expect(studentState("needs_review", effective(items, null, { c1: true, c2: true, c3: true }))).toBe("graded")
  })
})

describe("reviewRisk", () => {
  const base = { reviewReason: null, confidence: "high" as const, staleRubric: false, overridden: false, score: 4 }
  it("ranks failures above abstentions above low confidence", () => {
    const failed = reviewRisk({ ...base, status: "needs_review", reviewReason: "grading_failed", score: null })!
    const illegible = reviewRisk({ ...base, status: "needs_review", reviewReason: "illegible", score: null })!
    const low = reviewRisk({ ...base, status: "graded", confidence: "low" })!
    expect(failed.risk).toBeGreaterThan(illegible.risk)
    expect(illegible.risk).toBeGreaterThan(low.risk)
  })
  it("drops confident grades and anything the teacher already resolved", () => {
    expect(reviewRisk({ ...base, status: "graded" })).toBeNull()
    expect(reviewRisk({ ...base, status: "graded", confidence: "low", overridden: true })).toBeNull()
  })
})

describe("codes", () => {
  it("never contains look-alike characters, and normalises typing", () => {
    for (let i = 0; i < 200; i++) expect(shortCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/)
    expect(normaliseCode(" ab3-k9x ")).toBe("AB3K9X")
    expect(sha256("x")).toHaveLength(64)
  })
})
