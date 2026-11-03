# Decisions

This is a numbered log of every call the brief left open and every choice that adds a dependency, service, table or abstraction. ★ marks the **headline** decisions, which the README leads with. `Pxx` refers to the project's working principles. The design itself is in [`docs/PLAN.md`](docs/PLAN.md).

Status values:
- **Proposed**: awaiting review.
- **Accepted**: agreed.
- **Asked Alp**: waiting on Goblins.
- **Superseded by D-xx**: replaced by a later entry.

---

## Product

### D-01 ★ What "shown their score" means with feedback off
- **Context:** The brief says the student is shown their score and real-time feedback is off. Research shows a bare grade lowers interest, while feedback about the task itself keeps it up (Butler 1987/88).
- **Options:**
  - (a) points only
  - (b) points plus the criteria they met
  - (c) points plus met and unmet criteria
  - (d) nothing until the teacher releases scores
- **Decision:** (b) by default. The student sees `3 / 4` and the ✓ labels of met criteria ("✓ Set up the equation"). They never see unmet criteria, the answer, explanations or classmate comparisons. The teacher setting `showCriteriaToStudents` can drop it to (a). The score fills in asynchronously on the problem's chip.
- **Why:**
  - It's the most task-involving option that still counts as "feedback off". Showing unmet criteria would effectively be hints.
  - Students need something affirming to keep going ("inspire the love of learning").
- **Refs:** P8, §1.2
- **Status:** Accepted. Decided without Alp, using the reading above.
  - The brief turns off *real-time feedback*, meaning tutoring-style hints. Labels for met criteria are task-framed affirmation, not hints.
  - If Goblins reads it more strictly, `showCriteriaToStudents=false` gives score only. That's one setting, not a redesign.

### D-02 ★ One attempt per problem
- **Context:** The brief doesn't say whether students can resubmit.
- **Options:**
  - unlimited resubmits
  - one attempt
  - one attempt plus a teacher-granted retry
- **Decision:** One submitted attempt per problem. Before submitting, the student can redraw freely, and submit asks for confirmation. After submitting they can view the problem but not resubmit. The schema keeps an `attempt` column with unique `(student, problem, attempt)`, so adding a teacher-granted retry later is a small change, not a migration.
- **Why:**
  - This is grading, not practice. Resubmits plus a visible score would let students game the score toward the answer.
  - One attempt also caps model spend at one call per student per problem.
  - It matches the brief's flow: "submit, see score, continue to the next".
- **Refs:** P23, P8
- **Status:** Accepted. Decided without Alp.

### D-03 Problem input format and points
- **Context:** The brief doesn't say how problems are entered or how many points they're worth.
- **Decision:**
  - Problems are text, with inline `$…$` math rendered by KaTeX, plus an optional answer key.
  - Each problem gets 1–10 integer points (default 4). There are 1–10 problems per assignment.
  - No PDF or photo upload and no image problems.
- **Why:**
  - Typing a few Algebra problems takes a minute.
  - Upload-and-extract is a great time-to-magic feature, but it's a separate model pipeline with its own eval. It stays a stretch item listed in the README.
  - Integer points keep rubric math exact.
- **Refs:** P3, §6
- **Status:** Accepted

### D-04 ★ Identity and cross-device persistence without auth
- **Context:** The brief asks for no email auth, and data has to persist across devices.
- **Decision:**
  - **Teacher:** a *workspace* capability link (`/t#k=<128-bit secret>`), created silently with the first assignment.
    - It covers all of that teacher's assignments.
    - It's saved to `localStorage` and shown prominently with "bookmark this / email it to yourself".
    - One link per teacher, not per assignment, so the teacher has a home they come back to.
  - **Student:** class code plus display name returns a random token (kept in `localStorage`) and a short rejoin code shown on screen. Class code plus rejoin code restores the same student on any device.
  - Codes use an unambiguous alphabet (no 0/O/1/I/L).
  - Secrets sit in the URL fragment and are sent as `Authorization: Bearer …`. They never reach server logs or `Referer` headers. The server stores only hashes.
- **Why:**
  - Zero friction: no signup wall (P1).
  - The risk is named: anyone with the teacher link has access. That's acceptable for a free growth product and documented.
  - A new `teacher` table adds one row of complexity and buys a teacher home page. The rejected alternative, a separate link per assignment, leaves teachers with N links and no home.
- **Refs:** P1, P2, P7
- **Status:** Accepted

### D-05 What "progress" means in the report
- **Decision:** The report is a students × problems grid that refreshes live. Each cell is one of:
  - not started
  - grading…
  - a score
  - needs review (⚑)
  - teacher-adjusted (✎)

  Each row shows `submitted / total` and a running score. Above the grid:
  - class completion %
  - per-problem averages
  - **per-criterion miss rates** ("68% missed *flips the inequality*")
  - a risk-ranked review queue
  - the line "84 graded, 6 worth a look"
- **Why:** The report should answer "what do I do tomorrow?", not just list grades. Everything in it comes from data we already store.
- **Refs:** P5, P6
- **Status:** Accepted

### D-06 ★ Honest states when grading fails or is unsure
- **Decision:**
  - **Grading failed after retries, or the work is illegible:** no score. The student sees "Your teacher will check this one 👍". The teacher sees the item at the top of the review queue.
  - **Graded with low or medium confidence:** the score is shown to the student and the submission is ranked in the review queue.
  - **Teacher override:** the student's view updates to the teacher's score.
  - The completion screen says "Your teacher may adjust scores."
  - We never show a made-up or default score.
- **Why:**
  - Holding every low-confidence score would make the student-facing experience depend on a confidence signal that isn't calibrated yet.
  - The eval measures whether `low` predicts errors. If it does, we tighten the rule to hold `low` too (D-19).
- **Refs:** P9, P5, P18
- **Status:** Accepted

### D-07 Budget: the key's limit is $50, verified, not assumed
- **Context:** The brief says $20, and the email with the key says $50.
- **Decision:**
  - Resolved from data: OpenRouter `GET /api/v1/key` reports `limit = 50`, `limit_remaining = 50`, `usage = 0`, `limit_reset = null`. It's a one-time $50, not monthly.
  - Spend plan:
    - eval ≤ $1.20
    - canaries ≤ $0.25
    - rubric generation and dev use ≤ $3
    - everything else (about $45) is reserve for reviewers' live demo grading
  - At about $0.0005 per grade, $45 covers roughly 90,000 cheap-model grades.
  - The budget guard refuses model-spending jobs below `BUDGET_FLOOR_USD`, default $5, and reads `limit_remaining` live.
  - Any single eval or canary run projected above $2 still needs Saarthak's approval.
- **Why:** Read the number from the source of truth instead of guessing between two documents.
- **Refs:** P25, P27
- **Status:** Accepted (verified 2026-11-02)

### D-08 Rubric generated synchronously when a problem is saved
- **Decision:**
  - Generation is a blocking 3–8 s call with a skeleton loader, run when the teacher saves a problem.
  - It uses a stronger text model than the grader. It runs once per problem and costs under $0.01.
  - If it fails, the teacher gets an editable starter template.
- **Why:**
  - Seeing a rubric appear is part of the magic moment.
  - Quality matters more here, because every grade inherits the rubric.
- **Refs:** P3, P1
- **Status:** Accepted. The model is chosen in Phase 2.

### D-09 One-click sample assignment with pre-written rubrics
- **Decision:** "Try a sample" creates an Algebra 1 assignment using the four eval problems and their reviewed gold rubrics. It makes **no model call**, so it's instant and free.
- **Why:**
  - The fastest path to a class code. Time-to-magic is about 20 s.
  - Showing teachers the rubric the eval proved is better than showing a fresh, unchecked one.
- **Refs:** P1, P10
- **Status:** Accepted

### D-10 Editing a rubric after grades exist
- **Decision:**
  - Every rubric edit saves a new version, and grades keep the version they used.
  - The report flags "graded with an earlier rubric".
  - "Re-grade affected" is a stretch item (P19).
- **Refs:** P3, P19
- **Status:** Accepted

## Grading engine

### D-11 ★ Binary criteria; the model judges, code computes
- **Context:** P13 allows `met | partial | not_met` or points within a range.
- **Decision:**
  - Criteria are **binary** (`met`/`not_met`). Partial credit comes from splitting the work into criteria, typically setup, key step and answer, as Gradescope-style rubrics do.
  - The model returns the transcription first, then `legible`, then per-criterion verdicts with evidence, then a categorical `confidence`.
  - The model never sees point values and never produces a total.
  - Code validates the ids, sums the points, sets the status and computes a risk score.
- **Why:**
  - Binary judgments are more reproducible than graded ones, so the self-consistency flip rate goes down.
  - The rubric stays the single source of how points are split.
  - Hiding points removes any incentive for the model to reason about totals.
  - A self-reported confidence *number* is rarely calibrated, so three categories are more honest and easy to rank by.
  - Revisit if the eval shows teachers need within-criterion partial credit.
- **Refs:** P13, P14, P5
- **Conditions (Saarthak, 2026-11-02):**
  1. The rubric generator must produce **atomic, independently checkable** criteria: each one is a single fact a grader can verify on its own, never "sets up and solves". `rubric.v1.md` asks for this, and the eval checks generated rubrics against it.
  2. A criterion can be worth **more than 1 point**. The weight lives in `rubric.points`, and code applies it: total = Σ points of met criteria. The model still never sees weights.
- **Status:** Accepted with the two conditions above.

### D-12 ★ Async grading on a Postgres queue
- **Decision:**
  - Insert `submission` and `grading_job` in one transaction.
  - Workers claim jobs with `FOR UPDATE SKIP LOCKED`, set a lease (`lease_until`), and a sweeper re-queues expired leases.
  - The model call happens outside any transaction.
  - Retries use jittered exponential backoff and honor `Retry-After`. After capped attempts the submission goes to `needs_review`.
  - Idempotency is enforced by a unique `idempotency_key` and a unique `grading_job.submission_id`.
  - Workers run in the same image, behind `ROLE`.
  - **Provider concurrency is a global budget.** Cloud Run runs several instances (D-20), so a per-process `Semaphore` alone would let N instances × K calls overrun the provider. The claim query also checks the number of unexpired leases against `MODEL_MAX_IN_FLIGHT`. Each process keeps a local `Semaphore` as well.
    - Concurrent claims can overshoot the global cap by at most one job per instance.
    - If the load test shows that matters, the claim takes a transaction-scoped advisory lock (`pg_advisory_xact_lock`) to make the cap exact.
  - **Generic `job` table instead of `grading_job`.** Columns: `kind`, `payload`, `dedupe_key UNIQUE`.
    - Grading jobs use `dedupe_key = 'grade:' || submission_id`, which gives the same idempotency as a unique `submission_id`.
    - Phase 1 uses an `echo` job kind to prove the deployed worker end to end before grading exists.
    - It costs one column and adds no new table.
- **Why:**
  - The student never waits (P8).
  - A spike shows up as queue depth, not as errors (P24).
  - No new infrastructure (P22).
  - Rejected: Redis or SQS, because it's another service to run and its state lives outside Postgres.
  - Where this stops scaling is covered in LOADTEST.md.
- **Refs:** P8, P22, P23, P24
- **Status:** Accepted

### D-13 Image pipeline: strokes are the source of truth
- **Decision:**
  - The client renders a PNG from the strokes: cropped to the ink's bounding box plus padding, grayscale, long side ≤ 1024 px (final size set by the eval ablation).
  - The PNG is uploaded alongside the strokes and size-capped at 256 KB with a PNG magic-byte check.
  - The PNG is purged after the submission reaches a terminal state. Strokes stay, and the teacher view re-renders from them.
- **Why:**
  - Rendering on the client adds no server-side canvas dependency.
  - The same render function produces the eval fixtures.
  - Purging keeps a free-tier database small under load tests.
- **Refs:** P12, P16
- **Status:** Accepted

### D-14 Model client: a thin wrapper over `HttpClient`, checked against `@effect/ai-openrouter`
- **Decision:** The plan is a roughly 150-line `ModelClient` service built on `effect/http`'s `HttpClient`, with OpenAI-compatible chat completions and a configurable base URL. In Phase 2, before building it, check whether `@effect/ai-openrouter@4.1.2` exposes:
  - `usage.cost`
  - `response_format: json_schema`
  - raw status codes and `Retry-After`
  - SSE error events

  If it exposes all four cleanly, use it instead.
- **Why:** We need direct control over cost accounting, error classification (402 vs 429 vs 5xx) and the base-URL swap to fake-llm. A generic `LanguageModel` abstraction may hide those.
- **Refs:** P21, P25, §5
- **Status:** Accepted. To be verified by a Phase 2 spike.

### D-15 `model_call` ledger table
- **Decision:** Add a `model_call` table that records every call, including failed ones: purpose, model, status, tokens, cost, latency and error kind.
- **Why:** `grade` stores only successful calls. The budget guard, 429 rates and the cost per grade all need failed calls too. The simpler option, logs only, can't be queried after a load test.
- **Refs:** P25, P26
- **Status:** Accepted

### D-16 Effect reference: canonical `Effect-TS/effect` at 4.1.2, not effect-smol
- **Context:** The principles say to clone `Effect-TS/effect-smol`. That repo has been archived since July 2026 at 4.0.0-beta.98, and its README says v4 moved to `Effect-TS/effect`. npm `effect@latest` is 4.1.2.
- **Decision:**
  - Clone `Effect-TS/effect` at tag `effect@4.1.2` into `.repos/effect` (gitignored).
  - Pin `effect` and `@effect/*` to exactly 4.1.2.
- **Status:** Accepted (approved 2026-11-02)

### D-17 TypeScript 7 with `@effect/tsgo` instead of `@effect/language-service`
- **Context:** The Effect repo itself uses TypeScript 7 (native). The `@effect/language-service` README says to use `@effect/tsgo` with TS ≥ 7.
- **Decision:**
  - Pin `typescript@7.0.2` and `@effect/tsgo@0.64.1`.
  - A `prepare` script patches `tsc`, so Effect diagnostics fail the typecheck, not just the editor. A floating Effect was confirmed to fail `tsc`.
- **Status:** Accepted. A forced follow-on of D-16.

## Eval and model choice

### D-18 Eval gold set: 36 drawn fixtures
- **Decision:**
  - 4 Algebra 1 problems × 9 case types (see PLAN §7).
  - Drawn by hand in the app's fixture-capture mode.
  - Per-criterion ground truth, approved by Saarthak.
  - The same fixtures become load-test payloads.
- **Refs:** P17, P30
- **Status:** Accepted

### D-19 ★ Model choice is the cheapest model that clears an agreed bar
- **Decision:**
  - Candidates: 5 cheap vision models plus one strong reference, at live prices (PLAN §7).
  - Proposed bar:
    - exact total ≥ 85%
    - within one point ≥ 95%
    - false full credit ≤ 3%
    - false zero ≤ 3%
    - schema-valid ≥ 99%
    - p95 latency ≤ 15 s
  - Pick the cheapest model that passes. Build the cascade only if the eval shows `low` confidence is calibrated (P18).
  - Projected cost about $0.60, worst case about $1.20.
- **Refs:** P17, P18
- **Amendments (Saarthak, 2026-11-02):**
  - Every metric is reported with a **Wilson 95% confidence interval**. With about 36 cases, a 3% gate comes down to a single case, so the point estimate alone overstates certainty.
  - **False-full-credit rate** is computed only over gold cases whose true score is *not* full credit. The false-zero rate likewise uses only gold cases whose true score is not 0.
  - **Self-consistency gate:** across 3 runs, the total score changes in **≤ 5%** of cases.
  - **Abstention:** abstaining (`legible: false`) on work the gold set marks illegible counts as **correct**. Abstaining on legible work counts as an error, reported separately as the false-abstention rate.
  - The **strong reference model always appears** beside the cheap ones in every table and chart.
  - **If no cheap model clears the bar**, pick the best one, say so plainly in the README, and list the gates it misses.
- **Status:** Accepted with the amendments above.

## Infra and load testing

### D-20 ★ Hosting: $0, using Google Cloud Run (Free Trial) and Neon Free
- **Context:** Saarthak asked for free hosting wherever possible, and asked about Vercel specifically. Every candidate was checked against its vendor docs on 2026-11-02.
- **Decision:**
  - **Compute:** Google Cloud Run on a GCP **Free Trial** billing account. It has $300 of credit for 90 days, and Google's FAQ says you are not charged unless you manually upgrade.
  - **Region:** `us-east4`.
  - **Services** (amended by A2). Every service except fake-llm runs the same container image, with `ROLE` choosing what it does:
    | Service | Config | Purpose |
    |---|---|---|
    | `autograder-api` | prod, `ROLE=api`. Request-based billing, min 0, autoscaled, max-instances capped. | Teacher/student API and static web app. Pays a 1–2 s cold start after idle. |
    | `autograder-worker` | prod, `ROLE=worker`. Instance-based billing, min = max = 1 (D-27). | Always-on grading worker. |
    | `autograder-loadtest-api` / `autograder-loadtest-worker` | Same image. `MODEL_BASE_URL` points at fake-llm, using the `autograder-loadtest` Neon project. Min 0 when idle; the runner raises it during a run. | Load testing (P28). |
    | `fake-llm` | Request-based billing, high per-instance concurrency, min 0. | Simulated model provider. |
  - **Database:** Neon Free, no card. Two **separate projects**, `autograder-prod` and `autograder-loadtest`, both in AWS us-east-1, a few milliseconds from `us-east4`. See amendment A1.
  - **Supporting services:**
    - Artifact Registry for images.
    - Secret Manager for the OpenRouter key and database URLs.
    - A budget alert. It only alerts, because the trial already can't charge.
- **Options rejected:**
  - **Vercel Hobby:**
    - Load testing is allowed only on Enterprise plans, and the load test is the Part 2 deliverable.
    - It can't run a long-lived worker. Cron runs at most daily, and Bun functions are in beta.
    - Going over a limit pauses the project for 30 days.
    - Its non-commercial-use wording is a grey area for this project.
  - **Cloudflare Workers Free:** 10 ms CPU per request and 100k requests a day. One load-test run would use up the daily quota.
  - **Render, Koyeb free:** 0.1 vCPU, sleep with about 1-minute cold starts, and Render suspends free services with high traffic.
  - **Hugging Face Spaces:** Docker Spaces now need PRO.
  - **Oracle Always Free VM:** ARM capacity is often out of stock, VMs idle for 7 days get reclaimed, and the load test would share a box with prod.
  - **Fly.io:** no free tier, so it would cost about $6–12 a month.
- **Consequences:**
  - The API scales **horizontally**: Cloud Run adds instances under load. That makes provider concurrency a *global* budget, which D-12 enforces in Postgres.
  - Resources stop when the trial ends, about 90 days out. That covers the review period. Moving afterwards is a config change (same container): Fly, or a Cloud Run account that bills.
  - Loads here are small, at most about 20 submits/s and a few hundred requests/s. Google doesn't require pre-approval to test your own services within its Acceptable Use Policy (secondary sources; no official page found).
- **Refs:** P27, P28
- **Amendments (Saarthak, 2026-11-02):**
  - **A1. Two Neon projects, not branches.** Free-tier compute hours (100 CU-hours) and network transfer (5 GB) are limits *per project*. Separate projects stop a load test from using up prod's quota.
    - Each project has a pooled URL for the app (`DATABASE_URL`, `LOADTEST_DATABASE_URL`) and a direct URL for migrations (`DATABASE_URL_DIRECT`, `LOADTEST_DATABASE_URL_DIRECT`).
    - No Neon CLI or MCP tooling.
  - **A2. API and worker are separate Cloud Run services.**
    - Cloud Run gives a request-billed instance CPU only while it serves a request, so a background loop there would stall.
    - The API (`ROLE=api`) is a request-based, autoscaled service.
    - The worker (`ROLE=worker`) is a **service with instance-based billing, min = max = 1** (D-27 explains why this beats a worker pool).
    - Verification: after 20+ minutes with no HTTP traffic, the worker must still be alive and pick up a job promptly.
  - **A3. SIGTERM and leases.** Cloud Run sends SIGTERM and allows about 10 s.
    - On shutdown the worker stops claiming new jobs and gives in-flight calls up to about 8 s to finish. Anything still running is left to its lease, which expires and gets re-queued by the next worker.
    - The `chaos` scenario kills an instance mid-job and checks that nothing is lost.
  - **A4. Pooled connections for the app, direct for migrations.**
    - The app uses Neon's pooled string, which is PgBouncer in transaction mode.
    - Every queue operation is a **single SQL statement**, so `SKIP LOCKED` claims don't depend on holding a session. Session-level advisory locks, `LISTEN/NOTIFY` and `SET` aren't used. That pooled-string behaviour is checked against the real Neon pooler, not just local Postgres.
    - Migrations run over the direct string.
  - **A5. Neon cold start is accepted.**
    - Neon Free suspends compute after 5 minutes idle, and this can't be turned off.
    - Keep-warm pings would use up the 100 CU-hours: 0.25 CU × 730 h is about 182 CU-hours.
    - So the first request after an idle period pays a wake-up of roughly 0.5–2 s, and the worker is designed *not* to keep the database awake (D-27).
    - Load tests start with an explicit warm-up and report whether cold start falls inside the measured window.
  - **A6. 5 GB/month network-transfer budget per project.**
    - Strokes are the durable record. PNGs are small: grayscale, cropped, about 20–40 KB, and purged after grading.
    - Load tests use small fixture images and clean up by `run_id`.
    - Each load-test report estimates bytes transferred per run.
  - **A7. Free-tier ceilings are named as such.** If the breakpoint test hits Neon's 2 CU ceiling first, LOADTEST.md says it's a free-tier limit, not a design limit, and what a paid tier would change.
  - **A8. Credit guardrails.**
    - Projected 90-day credit burn stays under $150, estimated before the first deploy.
    - A $50 budget alert acts as a tripwire.
    - Every service has `max-instances` capped.
    - `autograder-loadtest` and `fake-llm` sit at min instances 0 when idle.
    - Region `us-east4`.
    - Secrets live in Secret Manager.
    - The billing account is never upgraded.
- **Status:** Accepted with amendments A1–A8.

### D-21 Load generator: custom Bun + Effect open model, not k6
- **Decision:**
  - A small generator replays a precomputed testing-day timeline: bell schedules, join bursts, lognormal think time, polling.
  - It scores latency against each request's *scheduled* send time.
  - A validity gate checks the generator's own send lag.
- **Why:**
  - Per-student timelines and realistic polling are awkward in k6's executors.
  - It reuses the domain schemas and fixtures, and needs no extra binary in CI.
  - The usual risk of a home-grown generator, its own bottleneck, is measured and gated.
- **Refs:** P30, P31
- **Status:** Accepted

### D-22 ★ SLOs, and the verdict they produce
- **Decision:** PLAN §8 values:
  - 0 lost submissions
  - submit p99 ≤ 500 ms
  - submit error rate ≤ 0.1%
  - time-to-grade p95 ≤ 30 s (p99 ≤ 60 s) at testing-day load
  - backlog drains ≤ 5 min after a spike
  - `needs_review` ≤ 1% when the provider is healthy, ≤ 5% under chaos
  - generator lag p99 ≤ 250 ms, as a validity gate

  Each run reports PASS / FAIL / INVALID per SLO.
- **Refs:** P32
- **Status:** Approved in principle. **Final values go to Saarthak before the first load-test run.** They must cover: the zero-lost invariant checked against the DB; submit p99; time-to-grade p95 at an expected load stated in classes and students; drain time after a spike; `needs_review` rate with a healthy provider; and whether Neon cold start is inside the measurement.

### D-23 Calibration canary runs against prod with a synthetic tenant
- **Decision:** About 50 real-model submissions through the deployed prod path, tagged with a `run_id` and cleaned up afterwards, behind the budget guard. Projected cost $0.02–0.05.
- **Why:** It exercises exactly the code and network path that the simulator is standing in for. Rejected: briefly re-pointing the loadtest environment at OpenRouter, because that's a config flip that's easy to leave on.
- **Refs:** P29
- **Status:** Accepted

### D-24 Polling with backoff and ETags, not SSE or websockets
- **Decision:**
  - Students poll only while a submission is pending, backing off from 2 s to 8 s.
  - The teacher report polls every 10 s.
  - Responses carry ETags, so unchanged polls return `304`.
- **Why:**
  - It's the simplest thing that works on school wifi.
  - The load test models polling explicitly, because at scale reads outnumber submits.
  - SSE is the documented next step, and a sync engine is what Goblins already has.
- **Refs:** §5 real-time, P11
- **Status:** Accepted

### D-25 Tests: `@effect/vitest` plus a real Postgres
- **Decision:**
  - Pure unit tests for scoring, rubric validation and code alphabets.
  - Queue tests (claim, lease, sweeper, idempotency) run against real Postgres: Docker locally, a service container in CI.
  - `TestClock` covers retry and backoff.
- **Why:**
  - SKIP LOCKED and lease semantics can't be mocked honestly.
  - `@effect/vitest` buys `it.effect` and `TestClock`, which is one dev dependency's worth.
- **Refs:** W4
- **Status:** Accepted

### D-26 Plain `.sql` migration files, run by Effect's migrator
- **Decision:** Migrations live in `apps/server/migrations/NNNN_name.sql`. A small loader reads them into `Migrator.fromRecord`, so Effect's `PgMigrator` handles ordering, locking and the migrations table.
- **Why:**
  - Effect's built-in file loader only imports `.ts`/`.js` modules.
  - Plain SQL is what a reviewer expects to read in a schema history, and it's what the principles' §5 asks for.
- **Status:** Accepted

### D-27 ★ Worker: a Cloud Run service with instance-based billing (min = max = 1), woken by the API
- **Context:** Amendment A2 to D-20 needs an always-running worker. The two Cloud Run options are an instance-based service and a worker pool.
- **Decision:** An instance-based **service**. CPU is always allocated, min and max are both 1, it uses 0.5–1 vCPU, and it exposes `POST /internal/wake` (bearer token).
- **How the worker runs:**
  - After committing a job, the API sends the worker a fire-and-forget wake request.
  - When idle, the worker sleeps until the earliest of:
    - a wake request
    - the next `run_after`, for retries with backoff
    - the next `lease_until`, to recover crashed jobs
    - a 60-minute safety poll
- **Why not a worker pool:**
  - A worker pool has no HTTP ingress, so it can only learn about new work by **polling Postgres**.
  - Polling more often than every 5 minutes keeps Neon awake around the clock: about 182 CU-hours a month at 0.25 CU, against a free allowance of 100.
  - Polling less often makes students wait minutes for a score.
  - A woken service gives instant pickup *and* lets Neon scale to zero.
  - Same container, same billing model.
- **Wake failures:**
  - A lost wake isn't a lost job. The job is already committed, and the timed poll or the lease sweep picks it up.
  - The wake only changes *latency*, never correctness.
- **Refs:** P22, P24, D-20 A2/A5
- **Status:** Accepted
