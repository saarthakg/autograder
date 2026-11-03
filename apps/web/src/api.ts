import { Api } from "@autograder/domain"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/**
 * Typed client derived from the shared contract (P21): a renamed field or
 * endpoint in packages/domain breaks the web build, not production. Scoped
 * to the public groups, so the browser never needs the internal token.
 */
export const fetchHealth = Effect.gen(function*() {
  const httpClient = yield* HttpClient.HttpClient
  const system = yield* HttpApiClient.group(Api, { group: "system", httpClient, baseUrl: window.location.origin })
  return yield* system.health()
}).pipe(Effect.provide(FetchHttpClient.layer))
