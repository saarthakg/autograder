import { AdminAuth, Api } from "@autograder/domain"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

/**
 * Typed clients derived from the shared contract (P21): a renamed field or
 * endpoint in packages/domain breaks the web build, not production.
 */
export const fetchHealth = Effect.gen(function*() {
  const httpClient = yield* HttpClient.HttpClient
  const system = yield* HttpApiClient.group(Api, { group: "system", httpClient, baseUrl: window.location.origin })
  return yield* system.health()
}).pipe(Effect.provide(FetchHttpClient.layer))

const makeAdmin = Effect.gen(function*() {
  const httpClient = yield* HttpClient.HttpClient
  return yield* HttpApiClient.group(Api, { group: "admin", httpClient, baseUrl: window.location.origin })
})
export type AdminClient = Effect.Success<typeof makeAdmin>

/** Runs `f` with the admin client, authenticated with the operator token (dev tools only). */
export const withAdmin = <A, E>(token: string, f: (admin: AdminClient) => Effect.Effect<A, E>) =>
  makeAdmin.pipe(
    Effect.flatMap(f),
    Effect.provide(Layer.mergeAll(
      FetchHttpClient.layer,
      HttpApiMiddleware.layerClient(AdminAuth, ({ next, request }) => next(HttpClientRequest.bearerToken(request, token)))
    ))
  )
