# Decisions

Every call the brief left open, and every choice that adds a dependency, service, table or abstraction. The ten headline decisions come first; the rest are under [Smaller decisions](#smaller-decisions). Numbers are stable, so code comments and reports can cite them. `Pxx` refers to the project's working principles.

Each entry carries a **final status**:
- **Shipped**: built and deployed as written.
- **Shipped, with changes**: the status says exactly what differs.
- **Superseded by D-xx**: replaced by a later entry.

## Headline decisions

### D-01 ★ Feedback off still shows what went right
- **Decision:** the teacher picks what students see in `student_view`: score only; score + the criteria they met (the default); or score + met + "Not yet" for unmet criteria, in neutral ink, never red. Students never see the answer, hints or classmates.
- **Why:** the brief turns off real-time feedback, meaning tutoring-style hints. Research shows a bare grade lowers interest, while feedback about the task keeps it up (Butler 1987/88). The outsider UI review found students "never see what they missed", and whether that's a hint is the teacher's classroom call.
- **The score moment:** after submitting, the student sees their own drawing beside "Grading…", which becomes the score in place. "Next problem →" works immediately, so nobody waits on the grader (P8).
- **Status:** Shipped, as amended on 2026-11-04 after the UI review. Decided without Alp.

### D-04 ★ No accounts: capability links and rejoin codes
- **Decision:** a teacher gets a private workspace link (`/t#k=<128-bit secret>`), created silently with their first assignment and covering all their assignments. A student joins with class code + name and gets a rejoin code; class code + rejoin code restores them on any device.
- **How:** secrets live in the URL fragment and travel as `Authorization: Bearer`, so they never reach logs or `Referer`. Only hashes are stored. Codes use an unambiguous alphabet.
- **Why:** zero friction, with the risk named: anyone holding the teacher link has access. That's acceptable for a free growth product.
- **Status:** Shipped.

### D-06 ★ Honest when unsure
- **Decision:** illegible work, or a grade that fails after retries, gets no score. The student sees "Your teacher will check this one" and the teacher sees it at the top of the review queue. Low-confidence grades are shown and ranked for review. A teacher override updates the student's view. We never show a made-up or default score.
- **Why:** the worst error is confident credit nobody checks (see D-30). Holding back every low-confidence score would rest on a confidence signal we couldn't calibrate.
- **Status:** Shipped. The eval found no grading errors to calibrate against, so `low` is ranked for review, not held back.

### D-11 ★ Binary criteria; the model judges, code adds up
- **Decision:** each criterion is met or not met. The model returns a transcription, then `legible`, then a verdict and evidence per criterion, then categorical confidence. It never sees points. Code validates the ids, sums the points (a criterion can be worth more than 1), sets the status and computes risk.
- **Why:** binary judgments are more reproducible (the flip rate was 0% at k=3). The rubric stays the only source of how points are split. Partial credit comes from atomic criteria (setup, key step, answer), as on Gradescope.
- **Status:** Shipped, with both conditions (atomic criteria; weights applied by code).

### D-12 ★ Grading runs on a Postgres queue
- **Decision:** submit writes the submission and its job in one transaction and returns at once. Workers claim with `FOR UPDATE SKIP LOCKED` and hold a 30 s lease renewed by a 10 s heartbeat; expired leases are re-queued, with attempts as the fencing token. Retries back off with jitter and honour `Retry-After`; after capped attempts the item goes to review. Idempotency keys stop double submits. The claim also checks a fleet-wide in-flight cap (`MODEL_MAX_IN_FLIGHT`) to protect the provider.
- **Why:** the student never waits (P8), and a spike shows up as queue depth, not errors (P24). It needs no new infrastructure. Redis or SQS was rejected: another service, with state outside Postgres.
- **Status:** Shipped. Chaos on prod: an instance killed mid-run lost 0 jobs, and stranded jobs came back within 30 s (38 s max time to grade, down from 66 s with a 60 s lease).

### D-19 ★ The cheapest model that clears an agreed bar
- **Decision:** five cheap vision models and a strong reference, each graded 20 hand-drawn cases × 3 runs through the production grader. Gates: exact total ≥ 85%, within one point ≥ 95%, false full credit ≤ 3%, false zero ≤ 3%, schema-valid ≥ 99%, flip rate ≤ 5%, p95 ≤ 15 s. Every metric carries a Wilson 95% interval over distinct cases. Pick the cheapest that passes.
- **Result:** `openai/gpt-6-luna`, at $0.00023 per grade, about 1/16 of the `gpt-6.1-sol` reference with the same scores. DeepSeek was rejected for empty responses; Qwen3-VL failed 4 gates, which shows the gates discriminate.
- **Caveat:** at n = 20, every top model's lower bound sits around 83%. This shows the cheap tier holds up on clean digital ink; it can't rank the top models.
- **Status:** Shipped. The confidence cascade was not built (see D-06), and the fallback was superseded by D-30.

### D-30 ★ The hard set caught the fallback inventing work
- **What happened:** a 3-case hard set (wrong work with the right answer, sloppy but correct work, a truly unreadable scribble), k=3. `gemini-3.1-flash-lite`, the planned fallback, cleared every gate on the main set but "read" `3x - 6 11` from the scribble all three times and awarded 3/4. Luna and sol abstained every time.
- **Decision:** the fallback is `gpt-6.1-sol`. Before leaving Luna, OpenRouter tries Luna on OpenAI, then Azure, then its other providers (`GRADING_PROVIDER_ORDER`). Every grade records which model and provider served it, and the teacher's drawer shows it.
- **Cost:** blended at a 2% fallback rate it's $0.00030 per grade. A full Luna outage costs $0.33 per class on sol; the budget guard stops spending at a $5 floor.
- **Rejected:** sending every fallback grade to review, which would bury teachers exactly when a provider is failing on a busy day.
- **Status:** Shipped (approved 2026-11-03).

### D-28 ★ One public service, load-tested where it runs
- **Decision:** one Cloud Run service (`us-east4`, `--no-cpu-throttling`, min 0, max 3, 1 vCPU / 512 MiB) runs the API, web app and grading worker in one process, on Neon Postgres. The load test hits the same public URL with admin-created `simulated` assignments, graded by an in-process simulator with calibrated latency and injected 429/5xx. A 50-call real-model canary calibrates it.
- **Why:** the brief asks for a public app plus a cheap, re-runnable load test in about 75 minutes per part. The first plan (D-20, D-27) had split API and worker services, a separate load-test environment and database, a deployed fake model, Secret Manager, IAM and a CI workflow, which took time from the product.
- **Trade-off, named:** load-test traffic shares prod's instance and database. Rows are tagged by `run_id` and deleted. The cut items are next steps in LOADTEST.md.
- **Status:** Shipped (approved 2026-11-02). Supersedes D-20 and D-27.

### D-22 ★ SLOs agreed before the first load test
- **Decision:**
  - 0 lost submissions, checked against the database
  - every submit eventually accepted
  - submit p99 ≤ 500 ms and error rate ≤ 0.1%
  - time to grade p95 ≤ 30 s and p99 ≤ 60 s at testing-day load (40 classes × 30 students × 10 problems, starts staggered over 15 min)
  - drain ≤ 5 min after a spike
  - `needs_review` ≤ 1% when the provider is healthy, ≤ 5% under chaos
- **Validity:** a run where the generator's own lag exceeds 250 ms p99 is INVALID, never a pass. Cold starts are measured but kept out of the SLOs. Under chaos, latency and errors are reported, not gated.
- **Status:** Shipped (values approved 2026-11-04). Verdicts are computed in `loadtest/src/slo.ts`.

### D-32 ★ Worker slots sized by Little's law
- **What the load test found:** one instance graded at most 9.3/s, because 32 slots ÷ 3.4 s per model call is about 9.4. Cloud Run scales on HTTP traffic and never saw the queue.
- **Decision:** `MODEL_CONCURRENCY` and `MODEL_MAX_IN_FLIGHT` are set to 128. 4× testing-day (25.8/s) needs about 88 in flight at median latency and about 116 at p95, so 96 would leave no headroom. Slots wait on the network: CPU was 40% and memory 31% at 4×.
- **Measured:** step 2× went from NO-SHIP (queue 347) to SHIP (queue 3), and 4× passes too, still on one instance. The next ceiling is predicted at about 37.6 grades/s.
- **Assumption:** OpenRouter and its upstream providers accept 128 concurrent calls; the canary only proved about 5/s.
- **Status:** Shipped (2026-11-04).

## Smaller decisions

### Product

**D-02 One attempt per problem.** Students redraw freely before submitting; after that they can view the problem but not resubmit. This is grading, not practice, so the score can't be gamed toward the answer, and spend is one call per student per problem. An `attempt` column with unique `(student, problem, attempt)` leaves room for a teacher-granted retry. *Status: shipped, with changes: there's no confirmation step; "You get one try per problem" sits beside the button. Decided without Alp.*

**D-03 Problem format.** Text with inline `$…$` math (KaTeX), an optional answer key, 1–10 integer points per problem, 1–10 problems per assignment. Upload-and-extract from a photo or PDF is a separate model pipeline with its own eval, so it's a next step. *Status: shipped.*

**D-05 The report answers "what do I do tomorrow?"** A live students × problems grid (not started, grading…, score, needs review ⚑, teacher-adjusted ✎), class completion, per-problem averages with n, "What the class missed" by criterion, and a review queue ranked by risk. *Status: shipped.*

**D-07 Budget read from the source.** The brief said $20 and the email said $50, so we read OpenRouter's `/key`: a one-time $50. The budget guard refuses model-spending jobs below a $5 floor, and any eval or canary projected above $2 needs approval. *Status: shipped. Total key usage across the project is about $0.27.*

**D-08 Rubrics drafted when a problem is saved.** A blocking 3–8 s call to a stronger text model (`openai/gpt-6.1-terra`, under $0.01 per problem), because every grade inherits the rubric. If it fails, the teacher gets an editable starter template. *Status: shipped.*

**D-09 One-click sample.** "Try a sample assignment" creates an Algebra 1 assignment from the eval's reviewed problems and rubrics, with no model call, so it's instant and free. *Status: shipped, with changes: three problems, not four, matching the gold set.*

**D-10 Rubric edits are versioned.** Grades keep the rubric version they used, and the report marks "graded with an earlier rubric" (↺). *Status: shipped; "re-grade affected" is a next step.*

### Grading engine

**D-13 Strokes are the source of truth.** The client renders a cropped grayscale PNG (≤ 1024 px, ≤ 256 KB, magic-byte checked) from the strokes. The PNG is cleared once a submission is final; strokes stay, and the teacher view re-renders from them. *Status: shipped.*

**D-14 A thin hand-rolled model client.** About 150 lines over Effect's `HttpClient`. The spike showed `@effect/ai-openrouter` doesn't pass through OpenRouter's `usage.cost`, which is authoritative. Strict JSON Schema output reuses Effect's own OpenAI codec. *Status: shipped.*

**D-15 A `model_call` ledger.** Every call, including failures: purpose, model, provider, status, tokens, cost, latency, error kind. The budget guard, 429 rates and load-test analysis all query it. *Status: shipped.*

**D-16 Effect 4.1.2 from the canonical repo.** `effect-smol` was archived at a beta, so all `effect` / `@effect/*` packages are pinned to 4.1.2 and APIs are checked against `Effect-TS/effect` at that tag. *Status: shipped.*

**D-17 TypeScript 7 with `@effect/tsgo`.** Effect's diagnostics fail `tsc`, not just the editor. *Status: shipped.*

### Eval

**D-18 Gold set drawn in the app's own whiteboard.** Per-criterion ground truth, approved by hand. The same drawings are the load test's payloads. *Status: shipped, with changes: 20 cases on 3 problems instead of the planned 36, plus the 3-case hard set (D-30).*

**D-29 Eval method.** Models are compared at live list price from measured tokens, because OpenRouter billed some calls at $0 and would have made a mid-priced model look free. Summaries can be rebuilt from saved results without paying again. *Status: shipped.*

### Load test and infrastructure

**D-21 A custom open-model load generator, not k6.** It replays a testing-day timeline (staggered class starts, joins, lognormal think time, polling), scores latency from each request's scheduled send time, and gates on its own lag. *Status: shipped (`loadtest/`).*

**D-23 Real-model canary on prod.** 50 real grades through the deployed path, tagged and cleaned up. Real latency (p50 2.8 s) was about 20% faster than the simulator's; no 429s or 5xx; cost $0.009. *Status: shipped.*

**D-24 Polling with backoff, not SSE.** Students poll 2 → 8 s only while a score is pending; the report polls 10 → 30 s; both stop in hidden tabs. *Status: shipped, with changes: ETags were not built. Polls answered in p99 73 ms at 4× load. SSE is the next step.*

**D-25 Tests on real Postgres.** `@effect/vitest`, with queue tests (claim, lease, sweeper, idempotency) against real Postgres, because `SKIP LOCKED` and lease semantics can't be mocked honestly. *Status: shipped (85 server tests, in CI).*

**D-26 Plain `.sql` migrations.** Run by Effect's migrator, and expand-only: 0006 kept the old `show_criteria` column rather than dropping it. *Status: shipped (0001–0007).*

**D-31 What the load test changed.** Measuring database transfer (Neon Free: 5 GB/month, shared with prod) found every student poll carrying the student's submitted drawings; drawings are now fetched once. Leases went from 60 s to 30 s with a heartbeat. The crash endpoint returns 404 unless the deploy is made with `ops/deploy.sh --chaos`. *Status: shipped.*

**D-20 Hosting across five Cloud Run services and two Neon projects.** *Superseded by D-28.* Vercel, Cloudflare Workers, Render, Koyeb, Hugging Face, Oracle and Fly were each ruled out on their own docs (load-testing terms, CPU limits, sleep, cost). Four of its amendments still hold, and code comments cite them:
- **A2:** the worker needs CPU outside requests, so the service runs with `--no-cpu-throttling`, and it must stay alive and pick up jobs after a long gap with no traffic.
- **A3:** on SIGTERM (about 10 s on Cloud Run) the worker stops claiming and gives in-flight jobs about 8 s; anything left falls back to its lease.
- **A4:** the app uses Neon's pooled connection (PgBouncer, transaction mode), so every queue operation is a single SQL statement with no session state; migrations use the direct connection.
- **A5:** Neon cold start is accepted: no keep-warm pings, and the idle worker sleeps long so the database can scale to zero.

**D-27 An always-on worker service woken by the API.** *Superseded by D-28:* the worker runs in-process. Its idle logic stays: sleep until the next retry or lease expiry, so Neon can scale to zero.
