import { AdminAuth, Api, StudentAuth, TeacherAuth } from "@autograder/domain"
import { Effect, Layer, Predicate } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

/**
 * One typed client derived from the shared contract (P21): a renamed field
 * or endpoint in packages/domain breaks the web build, not production.
 */
const makeClient = HttpApiClient.make(Api, { baseUrl: window.location.origin })
export type Client = Effect.Success<typeof makeClient>

export interface Tokens {
  readonly teacher?: string | undefined
  readonly student?: string | undefined
  readonly admin?: string | undefined
}

const bearer = (request: HttpClientRequest.HttpClientRequest, token: string | undefined) =>
  token === undefined ? request : HttpClientRequest.bearerToken(request, token)

const layers = (t: Tokens) =>
  Layer.mergeAll(
    FetchHttpClient.layer,
    HttpApiMiddleware.layerClient(TeacherAuth, ({ next, request }) => next(bearer(request, t.teacher))),
    HttpApiMiddleware.layerClient(StudentAuth, ({ next, request }) => next(bearer(request, t.student))),
    HttpApiMiddleware.layerClient(AdminAuth, ({ next, request }) => next(bearer(request, t.admin)))
  )

export type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly tag: string; readonly message: string; readonly error: unknown }

/** Runs one API call; never throws, so every screen handles failure explicitly (P9). */
export const call = <A, E>(tokens: Tokens, f: (client: Client) => Effect.Effect<A, E>): Promise<Outcome<A>> =>
  Effect.runPromise(
    makeClient.pipe(
      Effect.flatMap(f),
      Effect.provide(layers(tokens)),
      Effect.result,
      Effect.map((r): Outcome<A> => {
        if (r._tag === "Success") return { ok: true, value: r.success }
        const e = r.failure as unknown
        const tag = Predicate.hasProperty(e, "_tag") ? String(e._tag) : "Error"
        const message = Predicate.hasProperty(e, "message") ? String(e.message) : tag
        return { ok: false, tag, message, error: e }
      })
    )
  )

/** Friendly copy for failures a person might hit (P9: honest, calm states). */
export const friendly = (o: { tag: string; message: string }) =>
  o.tag === "HttpClientError" ? "Can't reach the server. Check your connection and try again." : o.message
