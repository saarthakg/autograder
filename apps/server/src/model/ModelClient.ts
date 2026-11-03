import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { AppConfig } from "../AppConfig.ts"

/**
 * One chat-completion call with structured output (D-14: a thin client over
 * HttpClient, so we keep OpenRouter's exact `usage.cost` and raw status codes).
 * The response body is returned as text; the caller decodes it with Schema,
 * because "invalid output" is a grading concern with its own retry rule (P14).
 */
export interface ModelRequest {
  readonly model: string
  readonly system: string
  readonly text: string
  readonly imagePng?: Uint8Array | undefined
  readonly schemaName: string
  readonly jsonSchema: object
  readonly maxTokens: number
  /** Appended as a follow-up user turn on the one retry after invalid output. */
  readonly correction?: string | undefined
}

export interface ModelResponse {
  readonly content: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly costUsd: number | null
  readonly latencyMs: number
  readonly httpStatus: number
}

/**
 * Provider failures, kept distinct because they're handled differently (P25):
 * rate limits wait for Retry-After, 402 means the key is out of credit, and a
 * bad request never succeeds on retry.
 */
export const ModelErrorKind = Schema.Literals([
  "rate_limited",
  "provider_error",
  "timeout",
  "network",
  "credits_exhausted",
  "bad_request",
  "budget_guard",
  "not_configured"
])
export type ModelErrorKind = typeof ModelErrorKind.Type

export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  kind: ModelErrorKind,
  message: Schema.String,
  httpStatus: Schema.optional(Schema.Int),
  retryAfter: Schema.optional(Schema.Duration),
  latencyMs: Schema.optional(Schema.Int)
}) {
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "provider_error" || this.kind === "timeout" ||
      this.kind === "network"
  }
}

export class ModelClient extends Context.Service<ModelClient, {
  readonly complete: (request: ModelRequest) => Effect.Effect<ModelResponse, ModelError>
}>()("autograder/ModelClient") {}

const ChatResponse = Schema.Struct({
  choices: Schema.optional(Schema.Array(Schema.Struct({
    message: Schema.Struct({ content: Schema.NullOr(Schema.String) })
  }))),
  usage: Schema.optional(Schema.Struct({
    prompt_tokens: Schema.optional(Schema.Number),
    completion_tokens: Schema.optional(Schema.Number),
    cost: Schema.optional(Schema.Number)
  })),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) }))
})
const decodeChat = Schema.decodeUnknownOption(ChatResponse)

/** Parses Retry-After as seconds or an HTTP date. Invalid values count as absent. */
export const parseRetryAfter = (value: string | undefined, now: number): Duration.Duration | undefined => {
  if (value === undefined || value.trim() === "") return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(seconds)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Duration.millis(Math.max(0, at - now))
}

export const classifyStatus = (status: number): ModelErrorKind =>
  status === 429 ? "rate_limited" :
  status === 402 ? "credits_exhausted" :
  status === 408 || status >= 500 ? "provider_error" :
  "bad_request"

export const buildBody = (request: ModelRequest) => {
  const userContent: Array<object> = [{ type: "text", text: request.text }]
  if (request.imagePng !== undefined) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${Buffer.from(request.imagePng).toString("base64")}` }
    })
  }
  const messages: Array<object> = [
    { role: "system", content: request.system },
    { role: "user", content: userContent }
  ]
  if (request.correction !== undefined) messages.push({ role: "user", content: request.correction })
  return {
    model: request.model,
    messages,
    temperature: 0,
    max_tokens: request.maxTokens,
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema }
    },
    // Only route to providers that honour response_format (P14).
    provider: { require_parameters: true },
    usage: { include: true }
  }
}

/** OpenRouter (or any OpenAI-compatible endpoint at MODEL_BASE_URL). */
export const OpenRouterModelLive = Layer.effect(
  ModelClient,
  Effect.gen(function*() {
    const config = yield* AppConfig
    const http = yield* HttpClient.HttpClient

    const complete = Effect.fn("ModelClient.complete")(function*(request: ModelRequest) {
      if (Option.isNone(config.model.apiKey)) {
        return yield* new ModelError({ kind: "not_configured", message: "OPENROUTER_API_KEY is not set" })
      }
      const started = Date.now()
      const elapsed = () => Date.now() - started
      const httpRequest = HttpClientRequest.post(`${config.model.baseUrl}/chat/completions`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(config.model.apiKey.value)),
        HttpClientRequest.setHeader("X-Title", "Goblins Auto-Grader"),
        HttpClientRequest.bodyJsonUnsafe(buildBody(request))
      )
      const response = yield* http.execute(httpRequest).pipe(
        Effect.timeoutOrElse({
          duration: config.model.timeout,
          orElse: () =>
            Effect.fail(new ModelError({ kind: "timeout", message: `no response within ${Duration.format(config.model.timeout)}`, latencyMs: elapsed() }))
        }),
        Effect.catchTag("HttpClientError", (e) =>
          Effect.fail(new ModelError({ kind: "network", message: e.message, latencyMs: elapsed() })))
      )
      const bodyText = yield* response.text.pipe(
        Effect.catch((e) => Effect.fail(new ModelError({ kind: "network", message: e.message, latencyMs: elapsed() })))
      )
      const latencyMs = elapsed()
      const parsed = decodeChat(safeJson(bodyText))
      if (response.status !== 200) {
        const retryAfter = parseRetryAfter(response.headers["retry-after"], Date.now())
        return yield* new ModelError({
          kind: classifyStatus(response.status),
          message: Option.match(parsed, { onNone: () => bodyText.slice(0, 300), onSome: (b) => b.error?.message ?? bodyText.slice(0, 300) }),
          httpStatus: response.status,
          latencyMs,
          ...(retryAfter === undefined ? {} : { retryAfter })
        })
      }
      if (Option.isNone(parsed)) {
        return yield* new ModelError({ kind: "provider_error", message: "unparseable provider response", httpStatus: 200, latencyMs })
      }
      const body = parsed.value
      const content = body.choices?.[0]?.message.content
      if (body.error !== undefined || content === undefined || content === null) {
        return yield* new ModelError({
          kind: "provider_error",
          message: body.error?.message ?? "provider returned no content",
          httpStatus: 200,
          latencyMs
        })
      }
      return {
        content,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        costUsd: body.usage?.cost ?? null,
        latencyMs,
        httpStatus: 200
      } satisfies ModelResponse
    })

    return ModelClient.of({ complete })
  })
)

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
