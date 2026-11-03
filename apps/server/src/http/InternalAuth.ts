import { InternalAuth, Unauthorized } from "@autograder/domain"
import { Effect, Layer, Redacted } from "effect"
import { timingSafeEqual } from "node:crypto"
import { AppConfig } from "../AppConfig.ts"

const equalConstantTime = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const InternalAuthLive = Layer.effect(
  InternalAuth,
  Effect.gen(function*() {
    const config = yield* AppConfig
    const expected = Redacted.value(config.internalToken)
    return InternalAuth.of({
      bearer: (httpEffect, { credential }) =>
        equalConstantTime(Redacted.value(credential), expected)
          ? httpEffect
          : Effect.fail(new Unauthorized({ message: "invalid internal token" }))
    })
  })
)
