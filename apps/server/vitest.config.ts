import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // DB-backed tests share one Postgres; run files serially.
    fileParallelism: false
  }
})
