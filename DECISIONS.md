# Decisions

This is a numbered log of every call the brief left open and every choice that adds a dependency, service, table or abstraction. ★ marks the **headline** decisions, which the README leads with. `Pxx` refers to the project's working principles. The design itself is in [`docs/PLAN.md`](docs/PLAN.md).

Every entry now carries a **final** status:
- **Shipped**: built and deployed as written.
- **Shipped, with changes**: built, and the status says exactly what differs from the text.
- **Superseded by D-xx**: replaced by a later entry, kept for the record.

Nothing is left Proposed or waiting on Goblins. D-01 and D-02 were decided without Alp, and say so.

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
- **Status:** **Final: shipped, as amended below** (three-way `student_view`, default score + met criteria). Decided without Alp.
  - The brief turns off *real-time feedback*, meaning tutoring-style hints. Labels for met criteria are task-framed affirmation, not hints.
  - If Goblins reads it more strictly, `showCriteriaToStudents=false` gives score only. That's one setting, not a redesign.
- **Amendment (Saarthak, 2026-11-04), after the outsider UI review:** the on/off toggle becomes a three-way teacher setting, `student_view`:
  - **score only**, which is (a)
  - **score + met criteria**, which is (b) and stays the default
  - **score + met + "Not yet"**, a gentle (c)
  - **Wording:** unmet criteria read "Not yet", in neutral ink, never red, and still never the answer or an explanation.
  - **The score moment:** after submitting, the student stays on the problem and sees their own drawing beside "Grading…", which becomes the score in place. "Next problem →" works immediately (P8), so nobody waits on the grader.
  - **Why:** the reviewer found students "never see what they missed". Whether that's a hint or useful feedback is the teacher's classroom call, so it's their setting, not ours.
  - Migration 0006 keeps the old `show_criteria` column (expand-only) and maps `false` to score only.

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
- **Status:** **Final: shipped, with one change.** Submit has no confirmation step. Instead, "You get one try per problem" sits beside the button. The `attempt` column is in place for a teacher-granted retry later. Decided without Alp.

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
- **Status:** **Final: shipped.** Upload-and-extract stays a next step.

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
- **Status:** **Final: shipped.**

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
- **Status:** **Final: shipped** (grid, completion, per-problem averages with n, "What the class missed", risk-ranked review queue).

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
- **Status:** **Final: shipped.** The eval found no grading errors to calibrate against, so `low` confidence is ranked for review but not held back from the student. Revisit as teacher overrides accumulate.

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
- **Status:** **Final: held.** Total key usage across all phases is about $0.27 of $50.

### D-08 Rubric generated synchronously when a problem is saved
- **Decision:**
  - Generation is a blocking 3–8 s call with a skeleton loader, run when the teacher saves a problem.
  - It uses a stronger text model than the grader. It runs once per problem and costs under $0.01.
  - If it fails, the teacher gets an editable starter template.
- **Why:**
  - Seeing a rubric appear is part of the magic moment.
  - Quality matters more here, because every grade inherits the rubric.
- **Refs:** P3, P1
- **Status:** **Final: shipped** with `openai/gpt-6.1-terra` (`RUBRIC_MODEL`) and the starter-template fallback.

### D-09 One-click sample assignment with pre-written rubrics
- **Decision:** "Try a sample" creates an Algebra 1 assignment using the four eval problems and their reviewed gold rubrics. It makes **no model call**, so it's instant and free.
- **Why:**
  - The fastest path to a class code. Time-to-magic is about 20 s.
  - Showing teachers the rubric the eval proved is better than showing a fresh, unchecked one.
- **Refs:** P1, P10
- **Status:** **Final: shipped,** with the **three** eval problems (p1–p3), not four, matching the gold set in D-18.

### D-10 Editing a rubric after grades exist
- **Decision:**
  - Every rubric edit saves a new version, and grades keep the version they used.
  - The report flags "graded with an earlier rubric".
  - "Re-grade affected" is a stretch item (P19).
- **Refs:** P3, P19
- **Status:** **Final: shipped** (versioned rubrics, ↺ "graded with an earlier rubric" mark). "Re-grade affected" was not built and is a next step.

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
- **Status:** **Final: shipped,** with both conditions.

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
- **Status:** **Final: shipped,** with two changes. The `ROLE` split was superseded by D-28 (one process). The advisory lock was not needed: every run used one instance, where the local `Semaphore` makes the cap exact. Slot counts are set by D-32.

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
- **Status:** **Final: shipped** (PNG cleared when a submission reaches a terminal state).

### D-14 Model client: a thin wrapper over `HttpClient`, checked against `@effect/ai-openrouter`
- **Decision:** The plan is a roughly 150-line `ModelClient` service built on `effect/http`'s `HttpClient`, with OpenAI-compatible chat completions and a configurable base URL. In Phase 2, before building it, check whether `@effect/ai-openrouter@4.1.2` exposes:
  - `usage.cost`
  - `response_format: json_schema`
  - raw status codes and `Retry-After`
  - SSE error events

  If it exposes all four cleanly, use it instead.
- **Why:** We need direct control over cost accounting, error classification (402 vs 429 vs 5xx) and the base-URL swap to fake-llm. A generic `LanguageModel` abstraction may hide those.
- **Refs:** P21, P25, §5
- **Spike result (Phase 2):** `@effect/ai-openrouter@4.1.2` handles `Retry-After`, 402 and `response_format`, but does not pass through OpenRouter's `usage.cost`. That figure is authoritative, because it includes image pricing and whichever provider was routed to. So the client is hand-rolled (about 150 lines in `apps/server/src/model/ModelClient.ts`). For the strict JSON Schema it reuses Effect's own `OpenAiStructuredOutput.toCodecOpenAI`, which inlines definitions, sets `additionalProperties: false`, and keeps every constraint enforced by the returned codec.
- **Status:** **Final: shipped.** Hand-rolled client, confirmed by the spike.

### D-15 `model_call` ledger table
- **Decision:** Add a `model_call` table that records every call, including failed ones: purpose, model, status, tokens, cost, latency and error kind.
- **Why:** `grade` stores only successful calls. The budget guard, 429 rates and the cost per grade all need failed calls too. The simpler option, logs only, can't be queried after a load test.
- **Refs:** P25, P26
- **Status:** **Final: shipped.** The load-test analysis reads it too.

### D-16 Effect reference: canonical `Effect-TS/effect` at 4.1.2, not effect-smol
- **Context:** The principles say to clone `Effect-TS/effect-smol`. That repo has been archived since July 2026 at 4.0.0-beta.98, and its README says v4 moved to `Effect-TS/effect`. npm `effect@latest` is 4.1.2.
- **Decision:**
  - Clone `Effect-TS/effect` at tag `effect@4.1.2` into `.repos/effect` (gitignored).
  - Pin `effect` and `@effect/*` to exactly 4.1.2.
- **Status:** **Final: shipped** (approved 2026-11-02).

### D-17 TypeScript 7 with `@effect/tsgo` instead of `@effect/language-service`
- **Context:** The Effect repo itself uses TypeScript 7 (native). The `@effect/language-service` README says to use `@effect/tsgo` with TS ≥ 7.
- **Decision:**
  - Pin `typescript@7.0.2` and `@effect/tsgo@0.64.1`.
  - A `prepare` script patches `tsc`, so Effect diagnostics fail the typecheck, not just the editor. A floating Effect was confirmed to fail `tsc`.
- **Status:** **Final: shipped.** A forced follow-on of D-16.

## Eval and model choice

### D-18 Eval gold set: 36 drawn fixtures
- **Decision:**
  - 4 Algebra 1 problems × 9 case types (see PLAN §7).
  - Drawn by hand in the app's fixture-capture mode.
  - Per-criterion ground truth, approved by Saarthak.
  - The same fixtures become load-test payloads.
- **Refs:** P17, P30
- **Status:** **Final: shipped, narrowed.** 20 cases on 3 problems, plus the 3-case hard set (D-30). The load test reuses the smallest of these drawings.

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
- **Status:** **Final: shipped.** `openai/gpt-6-luna` is the grader. The confidence cascade was not built: with no errors in the gold set, calibration couldn't be measured (P18). The fallback was superseded by D-30.
- **First run (2026-11-03, `evals/results/2026-11-03T05-10-14-515Z/`):** 20 cases × k=3 × 5 models; spend $0.23 billed, $0.32 at list price.
  - `openai/gpt-6-luna`, `google/gemini-3.1-flash-lite` and the `gpt-6.1-sol` reference clear every gate. `deepseek/deepseek-v4.1-flash` misses within-one by 0.2 points: 55/58, after 2 empty provider responses were excluded. `qwen/qwen3-vl-30b-a3b-instruct` misses 4 gates.
  - **Chosen: `openai/gpt-6-luna`** (approved 2026-11-03). On the 20-case set it scored:
    - exact total 95.0% [76–99]
    - criterion accuracy 100% [82–100]
    - false full credit 0%, false zero 0%
    - flip rate 0% at k=3, 100% schema-valid, no provider errors
    - p50 3.4 s, p95 4.5 s
    - $0.00023 per grade at list price, about 1/16 of the `gpt-6.1-sol` reference ($0.00363) with the same scores
  - **Fallback: `google/gemini-3.1-flash-lite`** (superseded by D-30: replaced by `gpt-6.1-sol` after the hard set) through OpenRouter's `models` routing. If the primary fails, OpenRouter tries the fallback.
    - It's config only (`GRADING_FALLBACK_MODELS`), with no extra code path to test.
    - It also cleared every gate, and its p95 is 2.3 s. It costs about 4× more ($0.00092), which is acceptable for an occasional fallback.
    - Each grade records the model that actually answered.
    - With fallbacks, the client sends only parameters every model in the chain supports.
  - **Caveat:** with n = 20, every top model's CI lower bound is about 76–82%. This set shows the cheap tier matches the reference here, but it cannot separate the top four.

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
- **Status:** **Final: superseded by D-28** (2026-11-02). Kept for the record of what was considered.

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
- **Status:** **Final: shipped** (`loadtest/`).

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
- **Final (approved by Saarthak, 2026-11-04):** the values above, gated as listed in `loadtest/src/slo.ts`. Expected load is testing-day: 40 classes × 30 students × 10 problems, starts staggered over 15 min, peaking near 7 submits/s. Neon and Cloud Run cold starts are measured but kept out of the SLOs (a warm-up runs first). Under chaos, latency, error rate and time to grade are reported, not gated.
- **Status:** **Final: shipped** (values approved 2026-11-04, as above).

### D-23 Calibration canary runs against prod with a synthetic tenant
- **Decision:** About 50 real-model submissions through the deployed prod path, tagged with a `run_id` and cleaned up afterwards, behind the budget guard. Projected cost $0.02–0.05. Under D-28 this is the same public service; the canary simply creates a *non-simulated* load-test assignment.
- **Why:** It exercises exactly the code and network path that the simulator is standing in for. Rejected: briefly re-pointing the loadtest environment at OpenRouter, because that's a config flip that's easy to leave on.
- **Refs:** P29
- **Status:** **Final: shipped.** The canary ran 50 real grades in a 10 s burst for $0.009 (LOADTEST.md).

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
- **Status:** **Final: shipped without ETags.** Students poll 2 → 8 s only while a score is pending, and the report polls 10 → 30 s; both stop in hidden tabs. ETags were not built. Payloads are small (~35 KB of transfer per submission, all in), and the load test showed polls at p99 73 ms. SSE stays the next step.

### D-25 Tests: `@effect/vitest` plus a real Postgres
- **Decision:**
  - Pure unit tests for scoring, rubric validation and code alphabets.
  - Queue tests (claim, lease, sweeper, idempotency) run against real Postgres: Docker locally, a service container in CI.
  - `TestClock` covers retry and backoff.
- **Why:**
  - SKIP LOCKED and lease semantics can't be mocked honestly.
  - `@effect/vitest` buys `it.effect` and `TestClock`, which is one dev dependency's worth.
- **Refs:** W4
- **Status:** **Final: shipped** (85 server tests on real Postgres, in CI).

### D-26 Plain `.sql` migration files, run by Effect's migrator
- **Decision:** Migrations live in `apps/server/migrations/NNNN_name.sql`. A small loader reads them into `Migrator.fromRecord`, so Effect's `PgMigrator` handles ordering, locking and the migrations table.
- **Why:**
  - Effect's built-in file loader only imports `.ts`/`.js` modules.
  - Plain SQL is what a reviewer expects to read in a schema history, and it's what the principles' §5 asks for.
- **Status:** **Final: shipped** (migrations 0001–0007, expand-only).

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
- **Status:** **Final: superseded by D-28.** The worker now runs in-process with the API, so the HTTP wake path is gone. The idle-wait logic (sleep until the next due retry or lease expiry) stays.

### D-28 ★ Hosting cut to the brief's minimum: one public URL, load test against it
- **Context:** The brief needs "a publicly hosted web app", plus a load test that is re-runnable and cheap, in about 75 minutes per part. The hosting plan that grew out of P28/P29/P33 (D-20 A1–A8, D-27) didn't fit that budget, and it pulled time away from the product. It would have needed a separately deployed loadtest environment and fake-llm, a second database, split API/worker services, Secret Manager, IAM, budgets and a CI load-test workflow.
- **Decision:**
  - **One Cloud Run service** (`autograder`, `us-east4`) runs API, web app and grading worker in **one process**.
    - `--no-cpu-throttling`, so the in-process worker keeps CPU after a submit request returns.
    - min instances 0, max 3, 1 vCPU / 512 MiB.
  - **Database:** the `autograder-prod` Neon project only. Pooled URL for the app, direct URL for migrations (run from a laptop).
  - **Secrets:** passed as env vars at deploy time from `.env`, through a temporary env-vars file so they never appear in shell arguments.
  - **APIs enabled:** Cloud Run and Artifact Registry only.
  - **Load test** (Phase 4) uses an **in-process model simulator** instead of a separate deployment.
    - Assignments created with the admin token are flagged `simulated`. Their jobs use a simulated model client with calibrated latency and 429/5xx injection. Real assignments use OpenRouter.
    - Every load-test row carries a `run_id`, and a cleanup command deletes a run.
    - One command, `bun run loadtest --scenario testing-day --target <url>`, works against the public URL and against localhost. It uses open-model arrivals, measures time-to-grade from DB timestamps, and reports PASS/FAIL per SLO.
    - A small budget-guarded **real-model canary** calibrates the simulator.
    - **One chaos check:** kill the instance mid-run and show zero lost submissions.
- **Narrows the principles:**
  - **P28:** the load test targets the *same* public deployment, with simulated tenants, instead of a separate loadtest environment.
  - **P29:** the simulator is a model client inside the server process, not a separate OpenAI-compatible service. The real HTTP model client is still exercised by the canary.
  - **P33:** re-runnable by one command; the GitHub Actions `workflow_dispatch` is cut.
- **Trade-offs, named:**
  - Load-test traffic shares the prod instance and database, so a run competes with real users. That's acceptable at take-home scale, and simulated rows are tagged and deleted.
  - In-process simulation skips the HTTP hop to a provider. Network and connection-pool behaviour toward OpenRouter is covered only by the canary.
  - Neon Free's 5-minute scale-to-zero means the first request after idle pays a cold start, and the load test warms up first.
  - Cloud Run cold start after idle is about 1–2 s.
- **Cost:** about $0–5 a month of trial credit. CPU is billed only while an instance is up, and instances stop after idling.
- **Cut, listed in LOADTEST.md "next steps":**
  - separate fake-llm deployment
  - the loadtest Neon project
  - API/worker split
  - Secret Manager
  - IAM setup
  - budget alerts
  - GitHub Actions load-test workflow
  - full chaos suite
- **Supersedes:** D-20 and D-27. Adjusts D-21 to D-23 as noted.
- **Refs:** P28, P29, P33, §0.1 (scoping under a tight time budget)
- **Status:** **Final: shipped** (Saarthak, 2026-11-02).

### D-29 Eval hygiene: fingerprinted fixtures, list-price comparison, rescore without spend
- **Fixtures are fingerprinted.** Each fixture stores a hash of the problem and drawing instructions its page showed. The server refuses stale saves, and the runner refuses to score stale fixtures. This came from two fixtures drawn in a tab opened before the instructions changed, which would have silently corrupted gold.
- **Models are compared at live list price** from measured tokens. OpenRouter billed $0 for all 60 Gemini calls, which made a mid-priced model look free. Billed cost is reported separately as actual spend.
- **`evals/src/rescore.ts`** rebuilds a summary from saved raw results, so reporting fixes never need a second paid run.
- **Raw `results.json` stays local** (gitignored). The summary and the compact `calibration.json` (per-call latency and tokens, for the Phase 4 simulator) are committed.
- **Refs:** P17, P29, W2
- **Status:** **Final: shipped.**

### D-30 ★ The hard set caught the fallback inventing work, so it was replaced
- **What happened:** the hard set (`evals/results/2026-11-04T02-59-09-733Z/`) has 3 cases at k=3: right answer with wrong work, sloppy but correct work, and a truly unreadable drawing.
  - `gpt-6-luna` and `gpt-6.1-sol` got all 9 samples right and abstained on the unreadable drawing every time.
  - **`gemini-3.1-flash-lite` "read" `3x - 6 11` from the scribble on all 3 runs and awarded 3/4.** It cleared every gate on the 20-case set, so only the hard set exposed this.
  - Confident partial credit for work nobody can read is the worst error this product can make: the teacher never sees it, and the student gets an unearned score.
- **Decision:**
  1. **Fallback model: `openai/gpt-6.1-sol`.** It cleared every gate on both sets and never graded unreadable work.
  2. **Provider order before model fallback:** `GRADING_PROVIDER_ORDER=openai,azure` is sent as OpenRouter's `provider.order`. OpenRouter serves Luna from OpenAI, Azure and Amazon Bedrock (checked on 2026-11-03), so an OpenAI outage moves to Azure, then the other Luna providers, before the request leaves Luna. In order: Luna on OpenAI → Luna on Azure → Luna on others → sol.
     - A base slug never matches a service-tier endpoint, so `openai/flex` (cheaper, but about 73% uptime over the last day) stays out.
     - A live call confirmed that OpenRouter honours the order and reports the serving provider.
  3. **Every grade records model and provider** (migration 0005). The teacher's review drawer shows "graded by `<model>` via `<provider>`".
- **Rejected: send every fallback grade to the review queue.** The fallback runs when Luna's provider is failing, which is most likely on a busy testing day. Queueing every fallback grade would bury the teacher in reviews exactly when the product matters most.
- **Blended cost** at list price from measured tokens: Luna $0.00023/grade, sol $0.00363/grade.
  - **Normal operation, about 2% fallback:** 0.98 × $0.00023 + 0.02 × $0.00363 = **$0.00030/grade**, compared with $0.00024 with Gemini as fallback. That is $0.00005 more per grade, or about half a cent per 100 grades.
  - **Full Luna outage, one class** (30 students × 3 problems = 90 grades): 90 × $0.00363 = **$0.33 per class** on sol, compared with $0.02 on Luna.
  - **Exposure:** about 135 classes in a full outage would drain the $50 key down to the budget guard's $5 floor (D-07). At that point grading stops and work queues for the teacher rather than overspending. The guard bounds the risk; it does not remove it. For a real deployment, alert on the share of grades from the fallback.
- **Config only:** `GRADING_FALLBACK_MODELS` and `GRADING_PROVIDER_ORDER`. The eval still measures each model alone, with no fallback and no order.
- **Refs:** P9, P14, P17, P25; amends D-19
- **Status:** **Final: shipped** (Saarthak, 2026-11-03).

### D-31 ★ What the load test changed
- **Transfer budget shaped the code.** Measuring Neon transfer (5 GB/month on Free, shared with prod) found that the score moment had put every submitted drawing into each student poll. The drawing is now a one-time fetch, and polls carry scores only. Each run projects its database transfer before it starts and refuses above a limit.
- **Leases: 30 s, renewed by a 10 s heartbeat (was 60 s).** Chaos on prod: stranded jobs recovered in 38 s, down from 66 s, with 0 lost either way. Slow model calls keep their job because the heartbeat renews the lease.
- **The crash switch exists only on a deploy made with `ops/deploy.sh --chaos`** (which sets `ENABLE_CHAOS=1`; the script refuses a stray `ENABLE_CHAOS` without the flag). Otherwise it returns 404, verified on prod after the chaos runs.
- **First bottleneck, measured:** one instance grades about 9.3/s (32 worker slots ÷ ~3.4 s per call), and Cloud Run doesn't scale on queue depth. Testing-day (6.9/s) passes; 14/s fails time-to-grade without losing work. Fixes, in order of cost, are in LOADTEST.md.
- **Refs:** P22, P24, P28–P33; D-22, D-28
- **Status:** **Final: shipped.**

### D-32 ★ Worker slots sized by Little's law: 128
- **Decision:** `MODEL_CONCURRENCY` 32 → **128** and `MODEL_MAX_IN_FLIGHT` 64 → **128**. The simulator's own provider cap (`SIM_MAX_CONCURRENT`) went 64 → 256, so it never limits the system under test.
- **Why 128 and not 96:** in flight = rate × latency. 4× testing-day peak (25.8/s) needs ~88 at median latency and ~116 at p95 (4.5 s). 96 would have no tail headroom. Slots wait on the network, so they're cheap: CPU p99 40%, memory 31% at 4×.
- **Measured on prod:** step 2× went from NO-SHIP (32 running, queue 347, time to grade p95 39.8 s) to SHIP (45 running, queue 3, p95 4.9 s). Step 4× SHIP (90 running, queue 3, p95 4.9 s). Still one instance.
- **Assumption, stated plainly:** OpenRouter and its upstream providers accept 128 concurrent calls from one key. The canary only proved ~5/s. Next ceiling, predicted: ~37.6 grades/s (128 ÷ 3.4 s). Cloud Run can't see the queue, so the fix after that is scaling workers on queue depth.
- **Refs:** P24, P28; D-12, D-31
- **Status:** **Final: shipped** (Saarthak asked for 96 or 128, 2026-11-04).
