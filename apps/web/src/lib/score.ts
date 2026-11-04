/**
 * Full / partial / zero, so a grid or a row of chips can be scanned at a
 * glance. Zero is neutral, never red: students see these too.
 */
export const scoreBand = (score: number, max: number): "full" | "partial" | "zero" =>
  score >= max ? "full" : score > 0 ? "partial" : "zero"
