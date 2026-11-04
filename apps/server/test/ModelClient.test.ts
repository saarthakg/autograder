import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { ModelClient, OpenRouterModelLive, parseRetryAfter, type ModelRequest } from "../src/model/ModelClient.ts"
import { testConfig } from "./support/TestConfig.ts"

/** A fake provider: records the request body and answers with a canned response. */
const fakeProvider = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const seen: Array<any> = []
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.url.endsWith("/models")) {
          return HttpClientResponse.fromWeb(request, Response.json({
            data: [{ id: "test/grader", supported_parameters: ["max_tokens", "response_format", "reasoning"] }]
          }))
        }
        const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}"
        seen.push({ url: request.url, auth: request.headers["authorization"], body: JSON.parse(raw) })
        return HttpClientResponse.fromWeb(
          request,
          new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })
        )
      })
    )
  )
  return { layer, seen }
}

const request: ModelRequest = {
  model: "test/grader",
  system: "sys",
  text: "grade this",
  imagePng: new Uint8Array([137, 80, 78, 71]),
  schemaName: "grade",
  jsonSchema: { type: "object" },
  maxTokens: 500
}

const run = (provider: ReturnType<typeof fakeProvider>, model: Parameters<typeof testConfig>[1] = {}) =>
  Effect.gen(function*() {
    const client = yield* ModelClient
    return yield* client.complete(request)
  }).pipe(Effect.provide(OpenRouterModelLive.pipe(Layer.provide([provider.layer, testConfig({}, model)]))))

describe("OpenRouter ModelClient", () => {
  it.effect("sends strict structured output with the image and reads usage cost", () =>
    Effect.gen(function*() {
      const provider = fakeProvider(200, {
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 1200, completion_tokens: 210, cost: 0.000345 }
      })
      const res = yield* run(provider)
      expect(res).toMatchObject({ model: "test/grader", content: "{\"ok\":true}", inputTokens: 1200, outputTokens: 210, costUsd: 0.000345 })
      const sent = provider.seen[0]
      expect(sent.url).toBe("https://model.test/api/v1/chat/completions")
      expect(sent.auth).toBe("Bearer test-key")
      expect(sent.body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } })
      expect(sent.body.provider).toEqual({ require_parameters: true })
      // Only parameters the catalog says the model supports: no temperature here.
      expect(sent.body.temperature).toBeUndefined()
      expect(sent.body.reasoning).toEqual({ effort: "low" })
      expect(sent.body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
    }))

  it.effect("classifies 429 with Retry-After as a retryable rate limit", () =>
    Effect.gen(function*() {
      const err = yield* run(fakeProvider(429, { error: { message: "slow down" } }, { "retry-after": "7" })).pipe(Effect.flip)
      expect(err.kind).toBe("rate_limited")
      expect(err.retryable).toBe(true)
      expect(err.retryAfter && Duration.toSeconds(err.retryAfter)).toBe(7)
    }))

  it.effect("treats 402 as out of credit and 400 as a non-retryable bad request", () =>
    Effect.gen(function*() {
      const credits = yield* run(fakeProvider(402, { error: { message: "insufficient credits" } })).pipe(Effect.flip)
      expect(credits.kind).toBe("credits_exhausted")
      expect(credits.retryable).toBe(false)
      const bad = yield* run(fakeProvider(400, { error: { message: "bad schema" } })).pipe(Effect.flip)
      expect(bad.kind).toBe("bad_request")
      expect(bad.retryable).toBe(false)
    }))

  it.effect("treats 5xx and a 200 carrying an error as retryable provider errors", () =>
    Effect.gen(function*() {
      expect((yield* run(fakeProvider(503, "upstream down")).pipe(Effect.flip)).kind).toBe("provider_error")
      const inBody = yield* run(fakeProvider(200, { error: { message: "upstream rate limit" } })).pipe(Effect.flip)
      expect(inBody.kind).toBe("provider_error")
      expect(inBody.retryable).toBe(true)
    }))

  it.effect("refuses to call without an API key", () =>
    Effect.gen(function*() {
      const err = yield* run(fakeProvider(200, {}), { apiKey: Option.none() }).pipe(Effect.flip)
      expect(err.kind).toBe("not_configured")
    }))
})

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates, ignoring garbage", () => {
    expect(Duration.toSeconds(parseRetryAfter("12", 0)!)).toBe(12)
    expect(Duration.toMillis(parseRetryAfter(new Date(5_000).toUTCString(), 1_000)!)).toBe(4_000)
    expect(parseRetryAfter("soon", 0)).toBeUndefined()
  })
})

describe("fallback routing", () => {
  it.effect("sends the models chain and only parameters every model supports, and reports who answered", () =>
    Effect.gen(function*() {
      const seen: Array<any> = []
      const http = Layer.succeed(HttpClient.HttpClient, HttpClient.make((req) => Effect.sync(() => {
        if (req.url.endsWith("/models")) {
          return HttpClientResponse.fromWeb(req, Response.json({ data: [
            { id: "test/grader", supported_parameters: ["response_format", "reasoning"] },
            { id: "test/fallback", supported_parameters: ["response_format", "reasoning", "temperature"] }
          ] }))
        }
        seen.push(JSON.parse(new TextDecoder().decode((req.body as any).body)))
        return HttpClientResponse.fromWeb(req, Response.json({ model: "test/fallback", provider: "Azure", choices: [{ message: { content: "{}" } }] }))
      })))
      const res = yield* Effect.gen(function*() {
        return yield* (yield* ModelClient).complete({ ...request, fallbackModels: ["test/fallback"], providerOrder: ["openai", "azure"] })
      }).pipe(Effect.provide(OpenRouterModelLive.pipe(Layer.provide([http, testConfig()]))))
      expect(seen[0].models).toEqual(["test/grader", "test/fallback"])
      expect(seen[0].provider).toEqual({ require_parameters: true, order: ["openai", "azure"] })
      expect(seen[0].temperature).toBeUndefined() // only the fallback supports it
      expect(seen[0].reasoning).toEqual({ effort: "low" })
      expect(res.model).toBe("test/fallback")
      expect(res.provider).toBe("Azure")
    }))
})

