import { HttpApi } from "effect/http-api"
import { AdminApi } from "./Admin.ts"
import { SystemApi } from "./System.ts"

/** The single API contract shared by server, web client and load generator. */
export class Api extends HttpApi.make("autograder").add(SystemApi).add(AdminApi).prefix("/api") {}
