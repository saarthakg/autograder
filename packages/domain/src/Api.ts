import { HttpApi } from "effect/http-api"
import { AdminApi } from "./Admin.ts"
import { LoadTestApi } from "./LoadTest.ts"
import { PublicApi, StudentApi, TeacherApi } from "./Product.ts"
import { SystemApi } from "./System.ts"

/** The single API contract shared by server, web client and load generator. */
export class Api extends HttpApi.make("autograder")
  .add(SystemApi)
  .add(PublicApi)
  .add(TeacherApi)
  .add(StudentApi)
  .add(AdminApi)
  .add(LoadTestApi)
  .prefix("/api")
{}
