import { Duration } from "effect"

interface BackoffPolicy {
  readonly base: Duration.Duration
  readonly cap: Duration.Duration
}

const defaultBackoff: BackoffPolicy = { base: Duration.seconds(2), cap: Duration.minutes(5) }

/**
 * Delay before retry number `attempt` (1-based): full jitter over an
 * exponentially growing window, capped. A provider's `Retry-After` is a
 * floor, never shortened by jitter. `random` is injected so tests are exact.
 */
export const retryDelay = (
  attempt: number,
  options: { readonly policy?: BackoffPolicy; readonly retryAfter?: Duration.Duration; readonly random: number }
): Duration.Duration => {
  const policy = options.policy ?? defaultBackoff
  const windowMs = Math.min(
    Duration.toMillis(policy.cap),
    Duration.toMillis(policy.base) * 2 ** Math.max(0, attempt - 1)
  )
  const jittered = Math.floor(windowMs * options.random)
  const floor = options.retryAfter ? Duration.toMillis(options.retryAfter) : 0
  return Duration.millis(Math.max(jittered, floor))
}
