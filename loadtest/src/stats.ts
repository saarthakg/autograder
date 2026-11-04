/** Nearest-rank percentile over a copy of the data; null when empty. */
export const percentile = (xs: ReadonlyArray<number>, p: number): number | null => {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]!
}

export const summary = (xs: ReadonlyArray<number>) => ({
  n: xs.length,
  p50: percentile(xs, 50),
  p95: percentile(xs, 95),
  p99: percentile(xs, 99),
  max: xs.length === 0 ? null : Math.max(...xs)
})

export const fmt = (x: number | null | undefined, digits = 0, unit = "") => x === null || x === undefined ? "–" : `${x.toFixed(digits)}${unit}`
