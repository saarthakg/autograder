import { Stroke, type StrokePoint } from "@autograder/domain"
import { useCallback, useEffect, useRef, useState } from "react"
import { hitsStroke, strokePath } from "./ink.ts"

export type Tool = "pen" | "eraser"

/**
 * Minimal whiteboard on perfect-freehand (P12): pen, stroke eraser, undo,
 * clear. Strokes are the source of truth; the parent derives the PNG.
 * Phase 3 polishes the UI; this is enough to draw eval fixtures.
 */
export function Whiteboard(props: {
  readonly width: number
  readonly height: number
  readonly onChange: (strokes: ReadonlyArray<Stroke>) => void
  /** Bump to clear the board from outside (e.g. after saving a fixture). */
  readonly resetKey?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [strokes, setStrokes] = useState<ReadonlyArray<Stroke>>([])
  const [history, setHistory] = useState<ReadonlyArray<ReadonlyArray<Stroke>>>([])
  const [tool, setTool] = useState<Tool>("pen")
  const drawing = useRef<{ start: number; points: Array<StrokePoint> } | null>(null)
  const { onChange } = props

  const commit = useCallback((next: ReadonlyArray<Stroke>) => {
    setHistory((h) => [...h.slice(-50), strokes])
    setStrokes(next)
    onChange(next)
  }, [strokes, onChange])

  useEffect(() => {
    setStrokes([]); setHistory([]); onChange([])
  }, [props.resetKey, onChange])

  // Redraw on every change; cheap at classroom stroke counts and no framework needed (P11).
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = props.width * dpr
    canvas.height = props.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, props.width, props.height)
    ctx.fillStyle = "#1f2430"
    for (const s of strokes) ctx.fill(strokePath(s))
    if (drawing.current) ctx.fill(strokePath({ points: drawing.current.points }))
  })

  const point = (e: React.PointerEvent): StrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = drawing.current ? performance.now() - drawing.current.start : 0
    // Mice report pressure 0 or 0.5; normalise so perfect-freehand simulates pressure.
    const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5
    return [e.clientX - rect.left, e.clientY - rect.top, pressure, Math.round(t)]
  }

  const erase = (e: React.PointerEvent) => {
    const [x, y] = point(e)
    const keep = strokes.filter((s) => !hitsStroke(s, x, y, 12))
    if (keep.length !== strokes.length) commit(keep)
  }

  return (
    <div className="whiteboard">
      <div className="toolbar" role="toolbar">
        <button aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>✏️ Pen</button>
        <button aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>🧽 Eraser</button>
        <button
          disabled={history.length === 0}
          onClick={() => {
            const prev = history[history.length - 1]
            if (prev === undefined) return
            setHistory(history.slice(0, -1)); setStrokes(prev); onChange(prev)
          }}
        >
          ↶ Undo
        </button>
        <button disabled={strokes.length === 0} onClick={() => commit([])}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: props.width, height: props.height, touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          if (tool === "eraser") return erase(e)
          drawing.current = { start: performance.now(), points: [] }
          drawing.current.points.push(point(e))
        }}
        onPointerMove={(e) => {
          if (tool === "eraser") return e.buttons === 1 ? erase(e) : undefined
          if (!drawing.current) return
          drawing.current.points.push(point(e))
          setStrokes((s) => [...s]) // trigger redraw of the live stroke
        }}
        onPointerUp={() => {
          const live = drawing.current
          drawing.current = null
          if (live && live.points.length > 0) commit([...strokes, new Stroke({ points: live.points })])
        }}
      />
    </div>
  )
}
