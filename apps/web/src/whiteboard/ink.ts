import type { Stroke, StrokePoint } from "@autograder/domain"
import { getStroke } from "perfect-freehand"

/** Shared pen look: the canvas and the PNG sent to the model must match (P16). */
const PEN = { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 } as const

type Pt = { readonly points: ReadonlyArray<StrokePoint> }

/** perfect-freehand outline -> filled Path2D. */
export const strokePath = (stroke: Pt): Path2D => {
  const outline = getStroke(
    stroke.points.map(([x, y, p]) => [x, y, p]),
    { ...PEN, simulatePressure: stroke.points.every(([, , p]) => p === 0.5) }
  )
  const path = new Path2D()
  if (outline.length === 0) return path
  const [first, ...rest] = outline
  path.moveTo(first![0]!, first![1]!)
  for (const [x, y] of rest) path.lineTo(x!, y!)
  path.closePath()
  return path
}

export const bounds = (strokes: ReadonlyArray<Pt>) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes) {
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * The image the model sees, derived from the strokes (D-13, P16): cropped to
 * the ink plus padding, black on white (effectively grayscale), long side
 * capped. Digital ink on a clean canvas removes most photo-quality failures.
 */
export const renderPng = async (
  strokes: ReadonlyArray<Stroke>,
  options: { readonly maxSide?: number; readonly padding?: number } = {}
): Promise<Uint8Array> => {
  const maxSide = options.maxSide ?? 1024
  const padding = options.padding ?? 24
  const b = bounds(strokes)
  const w = Math.max(1, b.maxX - b.minX + padding * 2)
  const h = Math.max(1, b.maxY - b.minY + padding * 2)
  const scale = Math.min(1.5, maxSide / Math.max(w, h))
  const canvas = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale))
  const ctx = canvas.getContext("2d")
  if (ctx === null) throw new Error("2D canvas unavailable")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.translate(padding - b.minX, padding - b.minY)
  ctx.fillStyle = "#000000"
  for (const s of strokes) ctx.fill(strokePath(s))
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Stroke-level eraser: touching any point of a stroke removes the whole stroke. */
export const hitsStroke = (stroke: Pt, x: number, y: number, radius: number) =>
  stroke.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= radius * radius)
