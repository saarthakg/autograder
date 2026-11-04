import { defineConfig, devices } from "@playwright/test"

/**
 * Runs against E2E_BASE_URL (default http://localhost:3000). Each run tags
 * the workspaces it creates with E2E_RUN_ID so they can be deleted afterwards.
 * Real grading happens for the one test that needs a flagged item (about $0.0002).
 */
export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1366, height: 768 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1366, height: 768 } } }]
})
