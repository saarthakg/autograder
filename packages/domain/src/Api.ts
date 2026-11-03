import { HttpApi } from "effect/http-api"
import { InternalApi } from "./Internal.ts"
import { SystemApi } from "./System.ts"

/** The single API contract shared by server, web client and load generator. */
export class Api extends HttpApi.make("autograder").add(SystemApi).add(InternalApi).prefix("/api") {}
