import type { Stroke } from "@autograder/domain"
import { useEffect, useRef } from "react"
import { bounds, strokePath } from "../whiteboard/ink.ts"

/** Read-only render of a student's ink, fitted to the box (teacher review). */
export function StrokeView(props: { readonly strokes: ReadonlyArray<Stroke>; readonly width: number; readonly height: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = props.width * dpr
    canvas.height = props.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, props.width, props.height)
    if (props.strokes.length === 0) return
    const b = bounds(props.strokes)
    const pad = 16
    const scale = Math.min(1.5, (props.width - pad * 2) / Math.max(1, b.maxX - b.minX), (props.height - pad * 2) / Math.max(1, b.maxY - b.minY))
    ctx.translate(pad, pad)
    ctx.scale(scale, scale)
    ctx.translate(-b.minX, -b.minY)
    ctx.fillStyle = "#1f2430"
    for (const s of props.strokes) ctx.fill(strokePath(s))
  }, [props.strokes, props.width, props.height])
  return <canvas ref={ref} className="stroke-view" style={{ width: props.width, height: props.height }} aria-label="Student's handwritten work" />
}
