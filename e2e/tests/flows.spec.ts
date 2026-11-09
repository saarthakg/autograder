import { expect, test } from "@playwright/test"
import { drawPolyline, inkPixels, joinOn, joinStudent, problemChip, publish, scribble, startSample } from "./helpers.ts"

/**
 * Browser regression tests for the student and teacher flows that unit tests can't reach.
 * They drive the real UI with real pointer input against E2E_BASE_URL.
 */

const X_EQUALS: ReadonlyArray<readonly [number, number]> = [[40, 40], [80, 90], [60, 65], [40, 90], [80, 40]]

test("an unsubmitted drawing survives a page reload", async ({ page, browser }) => {
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

test("switching problems keeps each draft, and a second student on the same browser starts blank", async ({ page, browser }) => {
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

test("after the teacher grades a flagged item by hand, the assignment list agrees with the report", async ({ page, browser }) => {
  await startSample(page)
  const code = await publish(page)
  const { page: student, context } = await joinStudent(browser, code, "Scribbler")
  await scribble(student)
  await student.getByRole("button", { name: /submit/i }).click()
  // With a real model, unreadable work first comes back to the student to rewrite; a second scribble goes to the teacher.
  // Without a model key, grading fails and the item goes straight to the teacher.
  const rewrite = student.getByText("We couldn't read your work clearly")
  const checked = student.getByText("Your teacher will check this one.")
  await expect(rewrite.or(checked)).toBeVisible({ timeout: 90_000 })
  if (await rewrite.isVisible()) {
    await scribble(student)
    await student.getByRole("button", { name: /submit/i }).click()
    await expect(checked).toBeVisible({ timeout: 90_000 })
  }
  await context.close()

  // The item is now in "Worth a look".
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

test("Publish saves pending rubric edits, and leaving with unsaved edits asks first", async ({ page }) => {
  await startSample(page)
  // The assignment opens as an overview; each rubric opens for editing on request.
  await expect(page.getByLabel("What a student did (shown to them when met)")).toHaveCount(0)
  await page.getByRole("button", { name: "Edit rubric" }).first().click()
  const firstLabel = page.getByLabel("What a student did (shown to them when met)").first()
  await firstLabel.fill("Subtracts 5 from both sides")
  await expect(page.getByRole("button", { name: "Save changes and publish" })).toBeVisible()
  await publish(page)

  await page.getByRole("tab", { name: "Rubrics" }).click()
  await expect(page.locator(".criteria-summary").first()).toContainText("Subtracts 5 from both sides")
  await page.reload()
  await page.getByRole("tab", { name: "Rubrics" }).click()
  await expect(page.locator(".criteria-summary").first()).toContainText("Subtracts 5 from both sides")

  // An unsaved edit, then "← All assignments": the page asks instead of discarding.
  await page.getByRole("button", { name: "Edit rubric" }).first().click()
  await page.getByLabel("What a student did (shown to them when met)").nth(1).fill("Unsaved edit")
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "← All assignments" }).click()
  await expect(page.getByText("You have unsaved rubric changes.")).toBeVisible()
  await expect(page).toHaveURL(/\/t\/a\//)
})

test("the whiteboard fills the window below the problem, on a Chromebook and a tablet", async ({ page, browser }) => {
  await startSample(page)
  const code = await publish(page)
  for (const viewport of [{ width: 1366, height: 768 }, { width: 820, height: 1180 }]) {
    const { page: student, context } = await joinStudent(browser, code, `Board${viewport.width}`, viewport)
    const box = (await student.locator("canvas").boundingBox())!
    expect(box.width).toBeGreaterThan(viewport.width - 80)
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 100)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await expect(student.getByRole("button", { name: "Submit" })).toBeInViewport()
    await context.close()
  }
})
