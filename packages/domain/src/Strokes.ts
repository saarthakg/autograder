import { Schema } from "effect"

/**
 * Whiteboard ink, the durable record of a student's work (P12). Each point is
 * [x, y, pressure, t] in canvas pixels and ms since the stroke began. The PNG
 * sent to the model is derived from these.
 */
export const StrokePoint = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
export type StrokePoint = typeof StrokePoint.Type

export class Stroke extends Schema.Class<Stroke>("Stroke")({
  points: Schema.Array(StrokePoint).check(Schema.isMinLength(1), Schema.isMaxLength(5_000))
}) {}

export const Strokes = Schema.Array(Stroke).check(Schema.isMaxLength(2_000))
export type Strokes = typeof Strokes.Type
