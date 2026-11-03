# Phase 0 plan

This is the design we agreed before writing app code. The *why* behind each call lives in [`DECISIONS.md`](../DECISIONS.md) as `D-xx`. This doc is the *what*. Principle references (`Pxx`) point to the project's working principles.

Prices and versions were checked on 2026-11-02:
- `effect@4.1.2`, TypeScript 7.0.2.
- Model prices from OpenRouter's `/api/v1/models`.
- Hosting prices from vendor pricing pages.

---

## 1. Architecture

```
                         ┌────────────────────────── one image, ROLE=api|worker|all ──────────────────────────┐
 Teacher / student  ───► │  HttpApi (Effect)  ──► Postgres ◄── Worker fibers ──► ModelClient ──► MODEL_BASE_URL │
 browser (React SPA,     │  serves static web     submission +     SKIP LOCKED      (Semaphore,      │            │
 polls with backoff)     │  /api/*  /internal/*   job in one tx    claim + lease    timeout, retry)  │            │
                         └─────────────────────────────────────────────────────────────────────────┼────────────┘
                                                                                                    ▼
                                                                      real assignments: OpenRouter   simulated (load-test) assignments: in-process simulator
```

- **One deployable, one process** (`apps/server`, D-28): the API, the built web app and the grading worker run together. Submits ring the in-process worker directly.
- **Submit is accept-and-queue.** `POST /submissions` validates the request, then inserts the `submission` row and its `grading_job` row in one transaction and returns `202`. The student never waits on the model (P8, P22, P24).
- **Workers** claim jobs with `FOR UPDATE SKIP LOCKED`:
  - Each claim sets a lease (`lease_until`). The model call happens outside the claim transaction.
  - A sweeper re-queues expired leases.
  - Retries use jittered exponential backoff and honor `Retry-After`. After capped attempts the submission goes to `needs_review` (P14, P22–P25).
- **The model judges, code computes.**
  - The model returns a transcription, a legibility flag, a confidence and per-criterion verdicts.
  - Code validates the response against a Schema, sums the points from the rubric and picks the status (P13).
- **Real vs simulated is per assignment, not per environment (D-28).** Assignments created with the admin token are flagged `simulated`, and their jobs use the in-process `SimulatedModel`. Everything else uses OpenRouter.

## 2. Data model (Postgres, plain SQL migrations)

| Table | Key columns | Notes |
|---|---|---|
| `teacher` | id, secret_hash, created_at | Capability identity: one bookmarkable link covers all of a teacher's assignments (D-04). |
| `assignment` | id, teacher_id, title, status `draft\|open\|closed`, class_code (unique, nullable until published), share_slug (unique, nullable), settings jsonb (`showCriteriaToStudents`), copied_from (nullable), created_at, published_at | |
| `problem` | id, assignment_id, position, prompt_md, answer_key (nullable), max_points (1–10), current_rubric_version | Prompt is Markdown with `$…$` math (D-03). |
| `rubric` | (problem_id, version) PK, items jsonb, reference_solution, source `generated\|edited\|sample`, model, prompt_version, created_at | Append-only: edits create a new version (P3). |
| `student` | id, assignment_id, display_name, rejoin_code, token_hash, created_at | unique(assignment_id, rejoin_code). Names never go to the model (P2). |
| `submission` | id, student_id, problem_id, attempt, idempotency_key (unique), strokes jsonb, image bytea (nullable), status `queued\|grading\|graded\|needs_review`, accepted_at, graded_at, run_id (nullable) | unique(student_id, problem_id, attempt). The image is purged once the submission is terminal (D-13). |
| `job` | id, kind, payload jsonb, dedupe_key (unique), status `queued\|running\|done\|dead`, attempts, max_attempts, run_after, lease_until, claimed_at, finished_at, last_error, run_id | Generic queue (D-12). Grading uses `dedupe_key = 'grade:'‖submission_id`. Partial index on `(run_after) WHERE status='queued'` for the claim query. |
| `grade` | id, submission_id, rubric_version, model, prompt_version, transcription, legible, confidence, verdicts jsonb, total_points (code-computed), model_started_at, model_finished_at, created_at | unique(submission_id, rubric_version). |
| `model_call` | id, purpose `grade\|rubric\|eval\|canary`, job_id (nullable), model, status, http_status, error_kind, input_tokens, output_tokens, cost_usd, latency_ms, run_id, created_at | Ledger for every call, including failures. It feeds the budget guard, cost accounting and 429/error rates (D-15). |
| `override` | id, grade_id, criterion_id, met (bool), created_at | Teacher corrections stored as labeled data (P4). Code recomputes the effective total. |

The lifecycle timestamps P26 asks for are covered by this schema:
- `accepted_at` on `submission`
- `claimed_at` on `job`
- `model_started_at` and `model_finished_at` on `grade`
- `graded_at` on `submission`

Every row a load test creates carries a `run_id`, so `DELETE … WHERE run_id = $1` cleans up the run.

## 3. API surface (Effect HttpApi; schemas shared from `packages/domain`)

Auth is a bearer capability: `Authorization: Bearer <teacher secret | student token>`.
- Secrets sit in the URL **fragment** (`/t#k=…`), so they never appear in server logs or `Referer` headers. The SPA reads the fragment and sends it as a header (D-04).
- The server stores only SHA-256 hashes of secrets.

**Teacher**
| Method & path | Purpose |
|---|---|
| `POST /api/teachers` | Create a workspace and return the secret. Happens implicitly on the first create. |
| `GET /api/teacher/assignments` | Teacher home. |
| `POST /api/assignments` | Create a draft with its problems. |
| `POST /api/assignments/sample` | One-click sample: an Algebra 1 set with pre-written rubrics, no model call (D-09). |
| `PUT /api/problems/:id` | Edit the problem text, answer key or max points. |
| `POST /api/problems/:id/rubric/generate` | Synchronous model call, about 3–8 s. Returns a validated rubric (D-08). |
| `PUT /api/problems/:id/rubric` | Save an edited rubric as a new version, after validation. |
| `POST /api/assignments/:id/publish` · `/close` | Publish issues a class code. Close stops new submissions. |
| `GET /api/assignments/:id/report` | Grid, averages, criterion miss rates and review queue. Supports an ETag. |
| `GET /api/submissions/:id` | Strokes, transcription and per-criterion verdicts with evidence. |
| `POST /api/grades/:id/overrides` | Flip one criterion. The total is recomputed. |
| `GET /api/assignments/:id/export.csv` | Gradebook export. |
| `POST /api/assignments/:id/share` · `GET /api/templates/:slug` · `POST /api/templates/:slug/copy` | Share a copy with a colleague: problems and rubrics only, never student data (P10). |

**Student**
| Method & path | Purpose |
|---|---|
| `POST /api/join` `{classCode, displayName}` | Returns `{token, rejoinCode}`. |
| `POST /api/rejoin` `{classCode, rejoinCode}` | Returns a new token for the same student. |
| `GET /api/me/assignment` | Problems plus this student's submissions and visible scores. Supports an ETag. |
| `POST /api/me/submissions` `{problemId, idempotencyKey, strokes, imagePng}` | Returns `202 {submissionId, status}`. A repeat of the same key returns the same row. |

**Ops**
- `GET /health`: liveness and a DB ping.
- `GET /internal/metrics`, token-protected: queue depth, age of the oldest job, model calls in flight, error and 429 rates over the last minute, and pool usage (P26).
- `POST /internal/runs` and `DELETE /internal/runs/:runId`, admin token: create simulated load-test assignments and delete a run's data.

## 4. File layout (adapts the principles' §5)

```
apps/server/        Effect HTTP API, worker, sweeper, migrations/ (plain .sql)
  src/http/         HttpApi groups + handlers
  src/grading/      ModelClient, prompts loader, grade + rubric services, scoring (pure)
  src/queue/        claim / lease / sweeper / retry policy
  src/db/           SqlClient layer, repositories
apps/web/           React + Vite SPA (teacher + student), whiteboard on perfect-freehand
packages/domain/    Shared Effect Schemas: Rubric, GradeOutput, API bodies, scoring helpers
prompts/            grade.v1.md, rubric.v1.md (versioned, loaded by name@version)
evals/              fixtures/ (strokes + PNG + ground truth), runner, results/
loadtest/           scenarios/, generator, slo.config.ts, analyze, reports/<run_id>/
docs/PLAN.md        this file
DECISIONS.md · LOADTEST.md · README.md
```

## 5. Grading prompt and output schema (`prompts/grade.v1.md`)

The prompt is ordered so the stable content comes first, which helps prompt caching (P15).

1. **System (stable):**
   - You grade one student's handwritten work on one middle-school math problem against a rubric. You do not tutor, hint or explain.
   - Step 1, *transcribe* exactly what is written, line by line, using plain math notation. Mark crossed-out work as `~~…~~`. Do not correct errors, and do not add steps that aren't there.
   - Step 2, decide each rubric criterion as `met` or `not_met` using only what you transcribed:
     - Mathematically equivalent forms count (`1/2` = `0.5`, `x = 4` = `4 = x`).
     - A valid alternative method earns the process criteria whose intent it satisfies.
     - Crossed-out work is ignored.
     - An answer with no work earns only answer criteria, unless a criterion says otherwise.
   - If you cannot read enough of the work to judge, set `legible: false` and do not guess.
   - Never compute a total score.
2. **Problem (stable per problem):** prompt, answer key, reference solution, and rubric criteria with ids and descriptions. Point values are deliberately **not** shown, so the model judges criteria rather than chasing points.
3. **User (variable, last):** the cropped, grayscale PNG of the student's ink.

Output, enforced with `response_format: json_schema` where the model's `supported_parameters` include it (P14), and decoded with Effect Schema:

```ts
GradeOutput = Struct({
  transcription: String,                       // written first: what the model read
  legible: Boolean,                            // false ⇒ abstain
  criteria: Array(Struct({
    id: String,                                // must match rubric item ids exactly, once each
    verdict: Literal("met", "not_met"),
    evidence: String.check(maxLength(240)),    // tied to the transcription
  })),
  confidence: Literal("high", "medium", "low"),
})
```

**What code does** (all pure functions, unit-tested; P13):
- Rejects the response if any rubric id is missing, duplicated or unknown.
- Totals the points as Σ `rubric.points` over the criteria marked `met`.
- Sets `status = needs_review` when `legible = false`. Otherwise sets `graded`.
- Computes a `risk` score for the review queue: failed > illegible > low confidence > medium > answer-only, with a bump for scores of exactly 0 or full marks.
- On a decode or validation failure, retries once with the error appended, then sends the submission to `needs_review` (P14).

Categorical confidence instead of a number is deliberate. A model's self-reported number usually isn't calibrated, while three buckets are honest and easy to rank by. The eval checks whether `low` actually predicts errors (D-11, P18).

## 6. Rubric schema and validation (`prompts/rubric.v1.md`)

```ts
RubricItem = Struct({
  id: String,                                   // "c1".."c6", stable across edits of the same item
  label: String.check(nonEmpty, maxLength(60)), // student-safe, task-framed: "Distributes 3 across (x − 2)"
  description: String.check(maxLength(300)),    // what earns it (for the grader + teacher)
  points: Int.check(between(1, 10)),
})
Rubric = Struct({
  items: Array(RubricItem).check(minLength(1), maxLength(6)),
  referenceSolution: String,
})
```

Validation runs on **both** generated and teacher-edited rubrics:
- Point values are integers.
- `Σ points == problem.max_points`.
- There are 1–6 items, with unique ids and non-empty labels.

Generation asks for 2–5 criteria: usually setup, key step(s) and the final answer. If the points don't add up, it retries once with the error. If it still fails, the teacher gets a starter template to fill in.

Code never rescales the points to make them fit (P14). Every edit saves a new version. Grades record the version they used, and a later edit marks older grades "graded with an earlier rubric" (P19 minimum).

## 7. Eval plan (`evals/`, P17)

**Gold set:** 36 cases. That's 4 problems × 9 case types, which you draw in the app's fixture-capture mode.

The problems are Algebra 1 / grade 7–8:
1. Solve `3(x − 2) = 2x + 5` (answer: `x = 11`). Tests distribution and the sign of the constant.
2. Solve `2x/3 + 1 = 5` (answer: `x = 6`). Tests fractions and equivalent forms.
3. *A plan costs $15 a month plus $0.10 per text. Maria paid $23.50. How many texts?* (answer: 85). Tests setting up the equation and units.
4. Solve `−2x + 3 > 11` (answer: `x < −4`). Tests flipping the inequality, a classic conceptual error.

The case types:
- correct standard method
- correct alternative method
- correct but in an equivalent form
- arithmetic slip with a sound setup
- conceptual error
- answer only, with no work
- blank or scribble
- messy work with crossed-out attempts
- hard-to-read handwriting

Ground truth is a per-criterion `met`/`not_met` for each case, scored against frozen gold rubrics, and you approve it.

**Candidates.** These are live prices per million tokens (input / output). All of them accept images and support structured outputs. The list is confirmed again at eval time.

| Model | $/M in | $/M out | Role |
|---|---|---|---|
| `z-ai/glm-5.3-flash` | 0.029 | 0.092 | ultra-cheap floor |
| `openai/gpt-6-luna` | 0.10 | 0.50 | cheap |
| `anthropic/claude-haiku-5.5` | 0.10 | 0.50 | cheap |
| `qwen/qwen3-vl-30b-a3b-instruct` | 0.15 | 0.60 | cheap, open weights (path to self-hosting at 1M) |
| `google/gemini-3.1-flash-lite` | 0.25 | 1.50 | cheap |
| `openai/gpt-6.1-sol` | 2.00 | 10.00 | strong reference (ceiling) |

**Metrics:**
- per-criterion accuracy
- total-score exact match
- within-one-point rate
- MAE
- false-full-credit and false-zero rates, reported separately
- abstention rate
- self-consistency (k = 3 runs; criterion flip rate)
- p50/p95 latency
- cost per grade, from returned usage × live price
- whether `low` confidence actually correlates with errors

There's also one **image-size ablation** on the best cheap model: 512 px vs 1024 px on the long side (P16).

**Proposed acceptance bar (needs your approval).** Each threshold, and why:
- **Exact total ≥ 85%:** teachers tolerate review, not constant correction.
- **Within one point ≥ 95%:** misses should be small.
- **False full credit ≤ 3%:** the costliest error is hiding a misconception.
- **False zero ≤ 3%:** discouraging students is the second-costliest error.
- **Schema-valid ≥ 99% after one retry:** P14.
- **p95 latency ≤ 15 s:** the time-to-grade SLO needs headroom.

We pick the **cheapest model that clears every line**. If none does, the reference model's score tells us whether the ceiling is the prompt and rubric or the model itself.

**Projected eval cost:**
- One grade is about 2,000 input tokens (instructions plus rubric plus an image of roughly 500–1,000 tokens) and about 300 output tokens.
- Cheap tier: about $0.0002–0.0008 per grade. 5 models × 36 cases × 3 runs is about 540 calls, roughly $0.30.
- Reference: 36 cases × 1 run at about $0.007 per grade, roughly $0.25.
- Ablation: about $0.05.
- **Total ≈ $0.60, worst case about $1.20** if reasoning tokens inflate output. That's under the $2 approval line. The runner prints its projection and checks `GET /api/v1/key` before spending.

## 8. Load-test plan (`loadtest/`, P28–P33)

**Target:** the public `autograder` service, or `localhost` (D-28). Load-test assignments are created with the admin token, flagged `simulated`, and graded by the in-process simulator, so default runs spend $0 on models. Each report records Cloud Run's instance count where it's visible.

**Generator:** a Bun + Effect script with an open arrival model (D-21).
1. It precomputes a timeline:
   - C classes of 30 students.
   - Class starts follow a bell schedule.
   - Students join over the first 0–120 s.
   - Each student works through P problems with lognormal think times: median about 3 min, a long tail, and a mean that fits 10 problems in about 40 min.
2. It fires each request at its scheduled time, whether or not earlier requests finished, and scores latency against that scheduled time.
3. It also simulates polling:
   - students poll with backoff only while they have something pending
   - teachers poll the report every 10 s

   At scale, polling can outweigh submits. For example, 30k students polling every 3 s is about 10k requests/s.
4. Payloads are the real fixture strokes and PNGs from the eval.
5. `--time-scale` compresses wall-clock time for cheap runs. The report always states the real-world-equivalent arrival rate.
6. A **validity gate** marks the run INVALID, not PASS or FAIL, if the generator itself falls behind: p99 lag between scheduled and actual send above 250 ms.

**Scenarios:**
| Scenario | Shape | Purpose |
|---|---|---|
| `smoke` | 1 class × 3 problems, 10× time compression, about 2 min | Runs in CI and on every deploy |
| `testing-day` | 40 classes (1,200 students), class starts staggered across a 15-min window (bell schedules differ by school), 10 problems each | Expected scale |
| `spike` | Whole district at 9:00: 100 classes (3,000 students) start at t = 0 and join within 60 s, so first-problem submits cluster in minutes 2–5 | Worst-case burst and drain time |
| `breakpoint` | Ramps the submission arrival rate until an SLO fails | Output is a number: the max sustained submits/s |
| `chaos` | `testing-day` with the instance killed mid-run (the only chaos check kept, D-28); simulator 429/5xx injection on | Proves no submission is lost and the backlog recovers |

**Measured from the server's clock (P31).** After a run, an analysis step queries Postgres by `run_id`:
- time-to-grade is `graded_at − accepted_at`
- the lost-submission invariant compares every idempotency key that got a 2xx response with the rows in the database, and checks each row reached a terminal state
- retries and 429s come from `model_call`

During the run, `/internal/metrics` is sampled every 5 s for queue depth and pool usage.

**SLO config** (`loadtest/slo.config.ts`, validated with Schema; starting values to agree on):
```ts
export default {
  lostSubmissions:          { max: 0 },                       // invariant, every scenario
  submitLatencyMs:          { p99: 500 },                     // vs scheduled send time
  submitErrorRate:          { max: 0.001 },                   // 5xx + timeouts; 4xx tracked separately
  timeToGradeSec:           { p95: 30, p99: 60 },             // testing-day; spike reports, doesn't gate p95
  drainAfterLastSubmitSec:  { max: 300 },                     // spike + chaos
  needsReviewRate:          { healthy: 0.01, chaos: 0.05 },
  generatorLagMs:           { p99: 250 },                     // validity gate → INVALID, not FAIL
}
```

**In-process simulator** (P29 as narrowed by D-28): a `SimulatedModel` implementation of the same `ModelClient` service.
- Returns schema-valid `GradeOutput` that's deterministic per submission (seeded by a hash of its content), using the real rubric ids.
- Reports realistic token usage, so projected real-model cost can be computed.
- Latency comes from a lognormal fitted to measured eval and canary latencies, with a tail multiplier.
- Configurable 429 (with `Retry-After`) and 5xx rates, plus a concurrency cap that returns 429, so retries and backoff run for real.

**Calibration canary** (D-23):
- About 50 submissions against the public service in a *non-simulated* load-test assignment, so the real OpenRouter path runs. Tagged with a `run_id` and cleaned up afterwards.
- Runs at modest concurrency, behind the budget guard. Projected cost is about $0.02–0.05.
- The report puts real and simulated latency distributions and end-to-end time-to-grade side by side, and states the gap.

**Outputs:**
- `loadtest/reports/<run_id>/report.md` and `report.html` (inline charts) and `raw.json`.
- Each report covers: config, timeline, percentiles, queue depth over time, provider errors and retries, projected real-model cost for the same load, and PASS/FAIL per SLO.
- `bun run loadtest --scenario testing-day --classes 40 --target <url>`.
- Default runs spend $0 on models.

**First Little's-law sizing**, to be recomputed with measured numbers:
- 30 students × 10 problems over 40 min is 0.125 submits/s per class.
- `testing-day` peak has all 40 classes overlapping: 40 × 0.125 = 5 submits/s. At about 6 s of model latency that's about 30 calls in flight.
- In `spike`, about 3,000 first-problem submits land within about 3 minutes, roughly 17 submits/s and about 100 calls in flight.
- Default `MODEL_CONCURRENCY` is 32 per worker, so `spike` is *meant* to build a queue. What we measure is how fast it drains (P24).

## 9. Hosting (D-28)

| Piece | Choice |
|---|---|
| App | One Cloud Run service `autograder` in `us-east4`: API, web app and worker in one process. `--no-cpu-throttling`, min 0, max 3. |
| Database | Neon Free project `autograder-prod`, AWS us-east-1. Pooled URL for the app, direct URL for migrations. |
| Secrets | Env vars at deploy time (`ops/deploy.sh`, from `.env`). |
| Load test | Same public service. Admin-created assignments are flagged `simulated` and graded by an in-process model simulator. |

Earlier designs (D-20 split services, D-27 woken worker) are superseded. What they would add is listed in LOADTEST.md "next steps".
