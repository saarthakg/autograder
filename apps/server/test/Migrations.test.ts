import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { splitStatements } from "../src/Migrations.ts"

describe("splitStatements", () => {
  it("splits on line-ending semicolons and drops blank/comment-only gaps", () => {
    const sql = `-- header comment
CREATE TABLE a (
  id int -- trailing comment; not a terminator
);

CREATE INDEX a_idx ON a (id);
`
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE a (\n  id int -- trailing comment; not a terminator\n);",
      "CREATE INDEX a_idx ON a (id);"
    ])
  })

  it("keeps $$-quoted bodies intact", () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $$
BEGIN
  RETURN 1;
END;
$$ LANGUAGE plpgsql;
SELECT 1;`
    const parts = splitStatements(sql)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain("RETURN 1;")
    expect(parts[1]).toBe("SELECT 1;")
  })

  it("splits the real first migration into its four statements", () => {
    const text = readFileSync(fileURLToPath(new URL("../migrations/0001_create_job.sql", import.meta.url)), "utf8")
    expect(splitStatements(text)).toHaveLength(4)
  })
})
