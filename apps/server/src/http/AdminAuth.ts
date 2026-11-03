import { AdminAuth, Unauthorized } from "@autograder/domain"
import { Effect, Layer, Redacted } from "effect"
import { timingSafeEqual } from "node:crypto"
import { AppConfig } from "../AppConfig.ts"

const equalConstantTime = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const AdminAuthLive = Layer.effect(
  AdminAuth,
  Effect.gen(function*() {
    const config = yield* AppConfig
    const expected = Redacted.value(config.adminToken)
    return AdminAuth.of({
      bearer: (httpEffect, { credential }) =>
        equalConstantTime(Redacted.value(credential), expected)
          ? httpEffect
          : Effect.fail(new Unauthorized({ message: "invalid admin token" }))
    })
  })
)
