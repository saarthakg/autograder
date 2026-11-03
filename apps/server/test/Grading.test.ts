import { checkVerdicts, CriterionVerdict, GradeOutput, Rubric, RubricItem, rubricProblems, totalPoints } from "@autograder/domain"
import { describe, expect, it } from "@effect/vitest"

const rubric = new Rubric({
  items: [
    new RubricItem({ id: "c1", label: "Distributes 3 across (x − 2)", description: "Writes 3x − 6", points: 1 }),
    new RubricItem({ id: "c2", label: "Isolates x", description: "Reaches x − 6 = 5 or equivalent", points: 1 }),
    new RubricItem({ id: "c3", label: "Finds x = 11", description: "Final answer x = 11", points: 2 })
  ],
  referenceSolution: "3x − 6 = 2x + 5 → x = 11"
})

const output = (criteria: Array<[string, "met" | "not_met"]>, legible = true) =>
  new GradeOutput({
    transcription: "3x - 6 = 2x + 5\nx = 11",
    legible,
    criteria: criteria.map(([id, verdict]) => new CriterionVerdict({ id, verdict, evidence: "" })),
    confidence: "high"
  })

describe("rubricProblems", () => {
  it("accepts a rubric whose weighted points sum to the problem max", () => {
    expect(rubricProblems(rubric, 4)).toEqual([])
  })
  it("rejects a points/max mismatch and duplicate ids", () => {
    expect(rubricProblems(rubric, 5)).toEqual(["criterion points sum to 4, but the problem is worth 5"])
    const dup = new Rubric({ items: [rubric.items[0]!, rubric.items[0]!], referenceSolution: "x" })
    expect(rubricProblems(dup, 2)).toContain("criterion ids must be unique")
  })
})

describe("checkVerdicts + totalPoints (code computes totals, P13)", () => {
  it("applies weights: met c1 and c3 earns 1 + 2", () => {
    const check = checkVerdicts(rubric, output([["c1", "met"], ["c2", "not_met"], ["c3", "met"]]))
    expect(check._tag).toBe("Valid")
    if (check._tag === "Valid") expect(totalPoints(rubric, check.met)).toBe(3)
  })
  it("rejects unknown, duplicate and missing criteria", () => {
    expect(checkVerdicts(rubric, output([["c1", "met"], ["c2", "met"], ["c9", "met"]]))).toMatchObject({ _tag: "Invalid" })
    expect(checkVerdicts(rubric, output([["c1", "met"], ["c1", "met"], ["c2", "met"]]))).toMatchObject({ _tag: "Invalid" })
    expect(checkVerdicts(rubric, output([["c1", "met"]]))).toMatchObject({ _tag: "Invalid", reason: "missing verdicts for c2, c3" })
  })
  it("lets an abstention omit verdicts, scoring nothing", () => {
    const check = checkVerdicts(rubric, output([], false))
    expect(check._tag).toBe("Valid")
    if (check._tag === "Valid") expect(totalPoints(rubric, check.met)).toBe(0)
  })
})

describe("sample problems and eval cases (D-09, D-18)", () => {
  it("every sample rubric is valid for its problem's max points", async () => {
    const { SAMPLE_PROBLEMS } = await import("@autograder/domain")
    for (const p of SAMPLE_PROBLEMS) expect(rubricProblems(p.rubric, p.maxPoints)).toEqual([])
  })
  it("every eval case's gold verdicts match its rubric's criteria count", async () => {
    const { EVAL_CASES, SAMPLE_PROBLEMS } = await import("@autograder/domain")
    for (const c of EVAL_CASES) {
      const problem = SAMPLE_PROBLEMS.find((p) => p.key === c.problem)!
      if (c.expect !== "abstain") expect(c.expect.length, c.key).toBe(problem.rubric.items.length)
    }
    expect(new Set(EVAL_CASES.map((c) => c.key)).size).toBe(EVAL_CASES.length)
  })
})
