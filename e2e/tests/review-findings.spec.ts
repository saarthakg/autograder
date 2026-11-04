import { expect, test } from "@playwright/test"
import { drawPolyline, inkPixels, joinOn, joinStudent, problemChip, publish, scribble, startSample } from "./helpers.ts"

/**
 * Regression tests for the outsider UI review (2026-11-04), one per "Broken" finding.
 * They drive the real UI with real pointer input against E2E_BASE_URL.
 */

const X_EQUALS: ReadonlyArray<readonly [number, number]> = [[40, 40], [80, 90], [60, 65], [40, 90], [80, 40]]

test("B1: an unsubmitted drawing survives a page reload", async ({ page, browser }) => {
  await startSample(page)
  const code = await publish(page)
  const { page: student, context } = await joinStudent(browser, code, "Reload", { width: 820, height: 1180 })
  await drawPolyline(student, X_EQUALS)
  const before = await inkPixels(student)
  expect(before).toBeGreaterThan(0)
  await student.reload()
  await expect(student.locator("canvas")).toBeVisible()
  expect(await inkPixels(student)).toBeGreaterThan(0)
  await expect(student.getByRole("button", { name: "Clear" })).toBeEnabled()
  await context.close()
})

test("B2: switching problems keeps each draft, and a second student on the same browser starts blank", async ({ page, browser }) => {
  await startSample(page)
  const code = await publish(page)
  const { page: student, context } = await joinStudent(browser, code, "Tabs")
  await drawPolyline(student, X_EQUALS)
  await problemChip(student, 2).click()
  expect(await inkPixels(student)).toBe(0) // problem 2 has its own, empty board
  await problemChip(student, 1).click()
  expect(await inkPixels(student)).toBeGreaterThan(0)

  // Shared Chromebook: a different student joins in the same browser.
  await joinOn(student, code, "Other")
  expect(await inkPixels(student)).toBe(0)
  await context.close()
})

test("B3: after the teacher grades a flagged item by hand, the assignment list agrees with the report", async ({ page, browser }) => {
  await startSample(page)
  const code = await publish(page)
  const { page: student, context } = await joinStudent(browser, code, "Scribbler")
  await scribble(student)
  await student.getByRole("button", { name: /submit/i }).click()
  await context.close()

  // Wait for the item to land in "Worth a look" (unreadable, or ungradable without a model key).
  const queue = page.locator(".review-queue")
  await expect(async () => {
    await page.reload()
    await expect(queue).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 90_000, intervals: [3_000] })

  await queue.getByRole("button").first().click()
  const drawer = page.getByRole("dialog", { name: "Submission" })
  const meets = drawer.getByRole("button", { name: /Met$/ })
  await expect(meets.first()).toBeVisible()
  for (let i = 0; i < (await meets.count()); i++) await meets.nth(i).click()
  await expect(drawer.locator(".score-line")).not.toContainText("–")
  await drawer.getByRole("button", { name: "Close" }).click()
  await expect(page.locator(".review-queue")).toHaveCount(0)

  await page.goto("/t")
  const row = page.locator(".card-list li").first() // a fresh workspace has just this one
  await expect(row).toContainText("1 graded")
  await expect(row).not.toContainText("to check")
})

test("B4: Publish saves pending rubric edits, and leaving with unsaved edits asks first", async ({ page }) => {
  await startSample(page)
  const firstLabel = page.getByLabel("What a student did (shown to them when met)").first()
  await firstLabel.fill("Subtracts 5 from both sides")
  await expect(page.getByRole("button", { name: "Save changes and publish" })).toBeVisible()
  await publish(page)

  await page.getByRole("tab", { name: "Rubrics" }).click()
  await expect(page.getByLabel("What a student did (shown to them when met)").first()).toHaveValue("Subtracts 5 from both sides")
  await page.reload()
  await page.getByRole("tab", { name: "Rubrics" }).click()
  await expect(page.getByLabel("What a student did (shown to them when met)").first()).toHaveValue("Subtracts 5 from both sides")

  // An unsaved edit, then "← All assignments": the page asks instead of discarding.
  await page.getByLabel("What a student did (shown to them when met)").nth(1).fill("Unsaved edit")
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "← All assignments" }).click()
  await expect(page.getByText("You have unsaved rubric changes.")).toBeVisible()
  await expect(page).toHaveURL(/\/t\/a\//)
})
