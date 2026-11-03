import { Rubric, RubricItem } from "./Grading.ts"

/**
 * The sample assignment (D-09) and eval problem set (D-18): three Algebra 1
 * problems with reviewed, frozen rubrics. Criteria are atomic and method-
 * agnostic, so a valid alternative method can earn them (D-11).
 */
export interface SampleProblem {
  readonly key: "p1" | "p2" | "p3"
  readonly prompt: string
  readonly answerKey: string
  readonly maxPoints: number
  readonly rubric: Rubric
}

const item = (id: string, label: string, description: string, points: number) =>
  new RubricItem({ id, label, description, points })

export const SAMPLE_PROBLEMS: ReadonlyArray<SampleProblem> = [
  {
    key: "p1",
    prompt: "Solve for $x$: $3(x - 2) = 2x + 5$",
    answerKey: "x = 11",
    maxPoints: 4,
    rubric: new Rubric({
      items: [
        item("c1", "Distributes the 3 to get 3x − 6", "Multiplies both terms in the parentheses by 3, writing 3x − 6 (for example 3x − 6 = 2x + 5).", 1),
        item("c2", "Gets the x terms on one side", "Reaches an equation with x on only one side, such as x − 6 = 5, 3x − 2x = 5 + 6, or x = 5 + 6, correctly following from the student's own previous line.", 1),
        item("c3", "Finds x = 11", "States the final answer x = 11 (11 = x also counts).", 2)
      ],
      referenceSolution: "3(x − 2) = 2x + 5\n3x − 6 = 2x + 5\nx − 6 = 5\nx = 11"
    })
  },
  {
    key: "p2",
    prompt: "Solve the inequality: $-2x + 3 > 11$",
    answerKey: "x < -4",
    maxPoints: 3,
    rubric: new Rubric({
      items: [
        item("c1", "Moves the constant term correctly", "Removes the +3 from the x side correctly, reaching −2x > 8, or an equivalent such as 3 − 11 > 2x or −8 > 2x.", 1),
        item("c2", "Divides and keeps the inequality direction right", "Divides by the coefficient of x and gets the direction right: flips the sign when dividing by a negative, keeps it when dividing by a positive. Judged from the student's own previous line.", 1),
        item("c3", "States x < −4", "Final answer x < −4 (−4 > x also counts).", 1)
      ],
      referenceSolution: "−2x + 3 > 11\n−2x > 8\nx < −4"
    })
  },
  {
    key: "p3",
    prompt:
      "A phone plan costs \\$15 per month plus \\$0.10 for each text message. Maria's bill this month was \\$23.50. How many text messages did she send?",
    answerKey: "85 texts",
    maxPoints: 3,
    rubric: new Rubric({
      items: [
        item("c1", "Accounts for the $15 fee", "Accounts for the $15 monthly fee before dividing by the per-text cost: an equation such as 15 + 0.10t = 23.50, or subtracting 15 from 23.50 first. Any method that handles the fee correctly counts.", 1),
        item("c2", "Finds the $8.50 spent on texts", "Gets 8.50 for the text cost, e.g. 0.10t = 8.50 or 23.50 − 15 = 8.50.", 1),
        item("c3", "Answers 85 texts", "Final answer 85 (with or without the word texts).", 1)
      ],
      referenceSolution: "15 + 0.10t = 23.50\n0.10t = 8.50\nt = 85 texts"
    })
  }
]

/**
 * Gold cases to draw in fixture-capture mode (D-18). `expect` is the gold
 * per-criterion verdict (1 = met), or "abstain" when the work is unreadable,
 * where abstaining is the correct answer (D-19).
 */
export interface EvalCase {
  readonly key: string
  readonly problem: SampleProblem["key"]
  readonly kind: "standard" | "alternative" | "arithmetic-slip" | "conceptual" | "answer-only" | "messy" | "unreadable"
  /** What to draw. Write it the way a student would; line breaks are "↵". */
  readonly draw: string
  readonly expect: ReadonlyArray<0 | 1> | "abstain"
}

export const EVAL_CASES: ReadonlyArray<EvalCase> = [
  { key: "p1-standard", problem: "p1", kind: "standard", draw: "3x − 6 = 2x + 5 ↵ x − 6 = 5 ↵ x = 11", expect: [1, 1, 1] },
  { key: "p1-alternative", problem: "p1", kind: "alternative", draw: "3x − 6 = 2x + 5 ↵ 3x − 2x = 5 + 6 ↵ 11 = x", expect: [1, 1, 1] },
  { key: "p1-arith-slip", problem: "p1", kind: "arithmetic-slip", draw: "3x − 6 = 2x + 5 ↵ x − 6 = 5 ↵ x = −1", expect: [1, 1, 0] },
  { key: "p1-conceptual", problem: "p1", kind: "conceptual", draw: "3x − 2 = 2x + 5 ↵ x − 2 = 5 ↵ x = 7   (only distributed to x)", expect: [0, 1, 0] },
  { key: "p1-answer-only", problem: "p1", kind: "answer-only", draw: "x = 11", expect: [0, 0, 1] },
  { key: "p1-messy", problem: "p1", kind: "messy", draw: "3x − 2 = 2x + 5 (cross it out) ↵ 3x − 6 = 2x + 5 ↵ x − 6 = 5 ↵ x = 11, a bit untidy", expect: [1, 1, 1] },
  { key: "p2-standard", problem: "p2", kind: "standard", draw: "−2x > 8 ↵ x < −4", expect: [1, 1, 1] },
  { key: "p2-alternative", problem: "p2", kind: "alternative", draw: "3 − 11 > 2x ↵ −8 > 2x ↵ −4 > x", expect: [1, 1, 1] },
  { key: "p2-arith-slip", problem: "p2", kind: "arithmetic-slip", draw: "−2x > 14 ↵ x < −7", expect: [0, 1, 0] },
  { key: "p2-conceptual", problem: "p2", kind: "conceptual", draw: "−2x > 8 ↵ x > −4   (forgets to flip)", expect: [1, 0, 0] },
  { key: "p2-answer-only", problem: "p2", kind: "answer-only", draw: "x < −4", expect: [0, 0, 1] },
  { key: "p2-messy", problem: "p2", kind: "messy", draw: "−2x > 8 ↵ x > −4 (cross out) ↵ x < −4", expect: [1, 1, 1] },
  { key: "p3-standard", problem: "p3", kind: "standard", draw: "15 + 0.10t = 23.50 ↵ 0.10t = 8.50 ↵ t = 85", expect: [1, 1, 1] },
  { key: "p3-alternative", problem: "p3", kind: "alternative", draw: "23.50 − 15 = 8.50 ↵ 8.50 ÷ 0.10 = 85 texts", expect: [1, 1, 1] },
  { key: "p3-arith-slip", problem: "p3", kind: "arithmetic-slip", draw: "15 + 0.10t = 23.50 ↵ 0.10t = 7.50 ↵ t = 75", expect: [1, 0, 0] },
  { key: "p3-conceptual", problem: "p3", kind: "conceptual", draw: "23.50 ÷ 0.10 = 235 texts   (ignores the $15 fee)", expect: [0, 0, 0] },
  { key: "p3-answer-only", problem: "p3", kind: "answer-only", draw: "85", expect: [0, 0, 1] },
  { key: "p3-messy", problem: "p3", kind: "messy", draw: "0.10t = 23.50 (cross out) ↵ 15 + 0.10t = 23.50 ↵ 0.10t = 8.50 ↵ t = 85, untidy", expect: [1, 1, 1] },
  { key: "p1-scribble", problem: "p1", kind: "unreadable", draw: "Scribbles and loops, no real math", expect: "abstain" },
  { key: "p2-illegible", problem: "p2", kind: "unreadable", draw: "Something math-like but tiny and overlapping, so it can't be read", expect: "abstain" }
]

/**
 * Fingerprint of what the fixture page told the drawer to draw (problem text +
 * instructions). Saved with each fixture; the eval refuses fixtures whose
 * fingerprint no longer matches the current case, so a fixture drawn from
 * stale instructions can't silently skew results. FNV-1a: not a security
 * hash, just a stable sync fingerprint usable in browser and server.
 */
export const instructionText = (c: EvalCase): string => {
  const problem = SAMPLE_PROBLEMS.find((p) => p.key === c.problem)
  return `${c.key}\n${problem?.prompt ?? ""}\n${c.draw}`
}

export const instructionHash = (c: EvalCase): string => {
  let h = 0x811c9dc5
  const text = instructionText(c)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) // UTF-16 code units: fine for a fingerprint, and DOM-free
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}
