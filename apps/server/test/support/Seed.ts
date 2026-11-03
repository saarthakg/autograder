import { Stroke } from "@autograder/domain"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
export const STROKES = [new Stroke({ points: [[10, 10, 0.5, 0], [20, 20, 0.5, 16]] })]

export const RUBRIC_ITEMS = [
  { id: "c1", label: "Distributes 3", description: "Writes 3x - 6", points: 1 },
  { id: "c2", label: "Isolates x", description: "Reaches x - 6 = 5", points: 1 },
  { id: "c3", label: "Finds x = 11", description: "Answer x = 11", points: 2 }
]

export const resetDb = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`TRUNCATE assignment, job, model_call CASCADE`
})

/** One assignment with one 4-point problem, its rubric, and one student. */
export const seedClass = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const [a] = yield* sql<{ id: string }>`INSERT INTO assignment (title) VALUES ('Test') RETURNING id`
  const [p] = yield* sql<{ id: string }>`
    INSERT INTO problem (assignment_id, position, prompt_md, answer_key, max_points)
    VALUES (${a!.id}, 1, 'Solve 3(x - 2) = 2x + 5', 'x = 11', 4) RETURNING id`
  yield* sql`INSERT INTO rubric (problem_id, version, items, reference_solution, source)
             VALUES (${p!.id}, 1, ${JSON.stringify(RUBRIC_ITEMS)}::jsonb, '3x - 6 = 2x + 5 -> x = 11', 'sample')`
  const [s] = yield* sql<{ id: string }>`
    INSERT INTO student (assignment_id, display_name, rejoin_code, token_hash)
    VALUES (${a!.id}, 'Ada', 'ABC123', ${crypto.randomUUID()}) RETURNING id`
  return { assignmentId: a!.id, problemId: p!.id, studentId: s!.id }
})
