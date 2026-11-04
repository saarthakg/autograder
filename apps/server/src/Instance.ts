import { Context, Layer } from "effect"

/** Identifies this process, so logs and /health reveal restarts. */
export class Instance extends Context.Service<Instance, {
  readonly id: string
  readonly startedAt: number
}>()("autograder/Instance") {
  static readonly layer = Layer.sync(Instance, () =>
    Instance.of({
      id: `${process.env.K_REVISION ?? "local"}-${crypto.randomUUID().slice(0, 8)}`,
      startedAt: Date.now()
    })
  )
}
