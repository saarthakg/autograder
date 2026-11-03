import { describe, expect, it } from "@effect/vitest"
import { Duration } from "effect"
import { retryDelay } from "../src/queue/Backoff.ts"

const ms = (d: Duration.Duration) => Duration.toMillis(d)

describe("retryDelay", () => {
  it("doubles the jitter window per attempt", () => {
    expect(ms(retryDelay(1, { random: 1 }))).toBe(2_000)
    expect(ms(retryDelay(2, { random: 1 }))).toBe(4_000)
    expect(ms(retryDelay(3, { random: 1 }))).toBe(8_000)
  })

  it("applies full jitter inside the window", () => {
    expect(ms(retryDelay(3, { random: 0.5 }))).toBe(4_000)
    expect(ms(retryDelay(3, { random: 0 }))).toBe(0)
  })

  it("caps the window", () => {
    expect(ms(retryDelay(20, { random: 1 }))).toBe(300_000)
  })

  it("never retries sooner than Retry-After", () => {
    expect(ms(retryDelay(1, { random: 0.1, retryAfter: Duration.seconds(30) }))).toBe(30_000)
    expect(ms(retryDelay(9, { random: 1, retryAfter: Duration.seconds(1) }))).toBe(300_000)
  })
})
