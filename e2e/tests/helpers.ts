import { type Browser, expect, type Page } from "@playwright/test"
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const RUN_ID = process.env.E2E_RUN_ID ?? `e2e-local-${Date.now()}`
const runsDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".runs")

/** Records a teacher secret under this run, so cleanup can find (and delete) what the run made. */
const record = (secret: string) => {
  mkdirSync(runsDir, { recursive: true })
  appendFileSync(join(runsDir, `${RUN_ID}.jsonl`), JSON.stringify({ runId: RUN_ID, teacherSecret: secret, at: new Date().toISOString() }) + "\n")
}

/** A fresh teacher: home page -> "Try a sample assignment". Lands on the sample's draft. */
export const startSample = async (page: Page) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Try a sample assignment" }).click()
  await page.waitForURL(/\/t\/a\//)
  const secret = await page.evaluate(() => localStorage.getItem("ag.teacher"))
  if (!secret) throw new Error("no teacher secret after creating the sample")
  record(secret)
  return { secret, url: page.url() }
}

export const publish = async (page: Page) => {
  await page.getByRole("button", { name: /publish/i }).first().click()
  const code = page.getByLabel("Class code")
  await expect(code).toHaveText(/^[A-Z0-9]{6}$/)
  return (await code.textContent())!.trim()
}

/** A student in a brand-new browser context (its own storage), joined and on problem 1. */
export const joinStudent = async (browser: Browser, classCode: string, name: string, viewport = { width: 1366, height: 768 }) => {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await joinOn(page, classCode, name)
  return { context, page }
}

export const joinOn = async (page: Page, classCode: string, name: string) => {
  await page.goto(`/join?code=${classCode}`)
  await page.getByLabel("Class code").fill(classCode)
  await page.getByLabel("Your first name").fill(name)
  await page.getByRole("button", { name: "Join", exact: true }).click()
  await expect(page.locator("canvas")).toBeVisible()
}

/** Real pointer input: down, many small moves, up (no injected strokes). */
export const drawPolyline = async (page: Page, points: ReadonlyArray<readonly [number, number]>) => {
  const box = (await page.locator("canvas").boundingBox())!
  const [x0, y0] = points[0]!
  await page.mouse.move(box.x + x0, box.y + y0)
  await page.mouse.down()
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    for (let s = 1; s <= 8; s++) await page.mouse.move(box.x + ax + ((bx - ax) * s) / 8, box.y + ay + ((by - ay) * s) / 8)
  }
  await page.mouse.up()
}

/** A messy scribble nobody can read. */
export const scribble = async (page: Page) => {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < 40; i++) pts.push([60 + ((i * 37) % 220), 60 + ((i * 53) % 180)])
  await drawPolyline(page, pts)
}

/** Count of non-white pixels on the board: 0 means the drawing is gone. */
export const inkPixels = (page: Page) =>
  page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 200) n++
    return n
  })

export const problemChip = (page: Page, n: number) => page.getByRole("navigation", { name: "Problems" }).getByRole("button").nth(n - 1)
