# Decisions

The product and engineering calls behind this app, and every choice that adds a dependency, service, table or abstraction. The ten headline decisions come first; the rest are under [Smaller decisions](#smaller-decisions). Numbers are stable, so code comments and reports can cite them. Each entry gives the context, the choice, why, and what was deferred.

## Headline decisions

### D-01 ★ A wrong answer still tells the student what to work on
- **Context:** this is a grader, not a tutor: it scores work and never hints at or reveals the solution. But a bare grade lowers interest, while feedback about the task keeps it up (Butler 1987/88), and a student with a wrong answer and no criteria met learns nothing from "0 / 4".
- **Choice:** by default, after grading a student sees their score, the criteria they met, and under "Not there yet" the criteria they didn't, as task-framed labels ("Distributes the 3"), in neutral ink, never red. The teacher can show less: score + met, or score only (`student_view`). Students never see the answer, hints or classmates. After submitting, the student sees their own drawing beside "Grading…", which becomes the score in place, and "Next problem →" works immediately.
- **Why:** naming what is missing points at the step to revisit without solving the problem for them. Nobody waits on the grader.

### D-04 ★ No accounts: capability links and rejoin codes
- **Context:** a free tool for teachers lives or dies on the first minute; a signup wall loses teachers, and students on shared Chromebooks can't manage passwords.
- **Choice:** a teacher gets a private workspace link (`/t#k=<128-bit secret>`), created silently with their first assignment and covering all their assignments. A student joins with class code + name and gets a rejoin code; class code + rejoin code restores them on any device. Secrets live in the URL fragment and travel as `Authorization: Bearer`, so they never reach logs or `Referer`. Only hashes are stored. Codes use an unambiguous alphabet.
- **Why:** zero friction, with the risk named: anyone holding the teacher link has access.
- **Deferred:** real accounts and link rotation.

### D-06 ★ Resolve uncertainty before it reaches the teacher
- **Context:** the worst error is confident credit nobody checks (see D-30), but sending every doubtful answer to the teacher hands back the grading the product exists to remove.
- **Choice:** uncertainty is resolved in order, and the teacher is the last resort:
  1. A low-confidence grade, work the model calls unreadable, or output that fails validation twice is re-graded by the stronger model (`ESCALATION_MODEL`, `gpt-6.1-sol`), and its answer is kept.
  2. Work that is still unreadable goes back to the student: "We couldn't read your work clearly enough to score it. Please write it again, one step per line." The rewrite reuses the same submission as attempt 2 and is graded normally.
  3. Only a second unreadable attempt, output neither model could produce, or a provider failure after retries reaches the teacher's review queue, and the student sees "Your teacher will check this one".
  A made-up or default score is never shown. A teacher override updates the student's view.
- **Why:** the stronger model abstained correctly on the hard set's unreadable scribble where a cheaper one invented work, so escalating is safe; asking the student to rewrite fixes the cause rather than the symptom. Escalation runs only on the uncertain minority, so the blended cost stays near the cheap model's.

### D-11 ★ Binary criteria; the model judges, code adds up
- **Context:** model-assigned point totals drift between runs and hide how the score was reached.
- **Choice:** each criterion is met or not met. The model returns a transcription, then `legible`, then a verdict and evidence per criterion, then categorical confidence. It never sees points. Code validates the ids, sums the points (a criterion can be worth more than 1), sets the status and computes risk.
- **Why:** binary judgments are more reproducible (the flip rate was 0% at k=3). The rubric stays the only source of how points are split. Partial credit comes from atomic criteria (setup, key step, answer), as on Gradescope.

### D-12 ★ Grading runs on a Postgres queue
- **Context:** a testing day is bursty, and a student should never wait on a model call.
- **Choice:** submit writes the submission and its job in one transaction and returns at once. Workers claim with `FOR UPDATE SKIP LOCKED` and hold a 30 s lease renewed by a 10 s heartbeat; expired leases are re-queued, with attempts as the fencing token. Retries back off with jitter and honour `Retry-After`; after capped attempts the item goes to review. Idempotency keys stop double submits. The claim also checks a fleet-wide in-flight cap (`MODEL_MAX_IN_FLIGHT`) to protect the provider.
- **Why:** a spike shows up as queue depth, not errors, and it needs no new infrastructure. Redis or SQS was rejected: another service, with state outside Postgres. On prod, an instance killed mid-run lost 0 jobs, and stranded jobs came back within 30 s (38 s max time to grade, down from 66 s with a 60 s lease).

### D-19 ★ The cheapest model that clears a fixed bar
- **Context:** grading cost is per student per problem, so the model choice sets the unit cost; but a cheap model that grades wrong is worse than useless.
- **Choice:** five cheap vision models and a strong reference, each graded 20 hand-drawn cases × 3 runs through the production grader. Gates: exact total ≥ 85%, within one point ≥ 95%, false full credit ≤ 3%, false zero ≤ 3%, schema-valid ≥ 99%, flip rate ≤ 5%, p95 ≤ 15 s. Every metric carries a Wilson 95% interval over distinct cases. Pick the cheapest that passes: `openai/gpt-6-luna`, at $0.00023 per grade, about 1/16 of the `gpt-6.1-sol` reference with the same scores.
- **Why:** gates set before the run can't be fitted to the result. They discriminate: DeepSeek was rejected for empty responses and Qwen3-VL failed 4 gates. At n = 20, every top model's lower bound sits around 83%, so this shows the cheap tier holds up on clean digital ink; it can't rank the top models.
- **Related:** the reference model doubles as the escalation model for uncertain grades (D-06).

### D-30 ★ The hard set caught the fallback inventing work
- **Context:** a 3-case hard set (wrong work with the right answer, sloppy but correct work, a truly unreadable scribble), k=3. `gemini-3.1-flash-lite`, the leading fallback candidate, cleared every gate on the main set but "read" `3x - 6 11` from the scribble all three times and awarded 3/4. Luna and sol abstained every time.
- **Choice:** the fallback is `gpt-6.1-sol`. Before leaving Luna, OpenRouter tries Luna on OpenAI, then Azure, then its other providers (`GRADING_PROVIDER_ORDER`). Every grade records which model and provider served it, and the teacher's drawer shows it.
- **Why:** blended at a 2% fallback rate it's $0.00030 per grade. A full Luna outage costs $0.33 per class on sol; the budget guard stops spending at a $5 floor. Sending every fallback grade to review was rejected: it would bury teachers exactly when a provider is failing on a busy day.

### D-28 ★ One public service, load-tested where it runs
- **Context:** a public deployment should be cheap to run, and its load test cheap to re-run against what users actually hit.
- **Choice:** one Cloud Run service (`us-east4`, `--no-cpu-throttling`, min 0, max 3, 1 vCPU / 512 MiB) runs the API, web app and grading worker in one process, on Neon Postgres. The load test hits the same public URL with admin-created `simulated` assignments, graded by an in-process simulator with calibrated latency and injected 429/5xx. A 50-call real-model canary calibrates it. What that runtime requires:
  - The worker needs CPU outside requests, hence `--no-cpu-throttling`, and it must stay alive and pick up jobs after a long gap with no traffic (a 5-minute heartbeat log proves it).
  - On SIGTERM (about 10 s on Cloud Run) the worker stops claiming and gives in-flight jobs about 8 s; anything left falls back to its lease.
  - The app uses Neon's pooled connection (PgBouncer, transaction mode), so every queue operation is a single SQL statement with no session state; migrations use the direct connection.
  - Neon cold start is accepted: no keep-warm pings, and the idle worker sleeps long so the database can scale to zero.
- **Why:** split API and worker services, a separate load-test environment and database, and a deployed fake model would each add moving parts without changing what the test proves about this app.
- **Trade-off, named:** load-test traffic shares prod's instance and database. Rows are tagged by `run_id` and deleted.
- **Deferred:** the items in LOADTEST.md's next steps.

### D-22 ★ SLOs set before the first load test
- **Context:** a load test without a pre-stated bar ends in "it felt fine".
- **Choice:**
  - 0 lost submissions, checked against the database
  - every submit eventually accepted
  - submit p99 ≤ 500 ms and error rate ≤ 0.1%
  - time to grade p95 ≤ 30 s and p99 ≤ 60 s at testing-day load (40 classes × 30 students × 10 problems, starts staggered over 15 min)
  - drain ≤ 5 min after a spike
  - `needs_review` ≤ 1% when the provider is healthy, ≤ 5% under chaos
- **Why:** a run where the generator's own lag exceeds 250 ms p99 is INVALID, never a pass, so a slow generator can't produce a fake pass. Cold starts are measured but kept out of the SLOs. Under chaos, latency and errors are reported, not gated. Verdicts are computed in `loadtest/src/slo.ts`.

### D-32 ★ Worker slots sized by Little's law
- **Context:** the load test found one instance graded at most 9.3/s, because 32 slots ÷ 3.4 s per model call is about 9.4. Cloud Run scales on HTTP traffic and never saw the queue.
- **Choice:** `MODEL_CONCURRENCY` and `MODEL_MAX_IN_FLIGHT` are set to 128.
- **Why:** 4× testing-day (25.8/s) needs about 88 in flight at median latency and about 116 at p95, so 96 would leave no headroom. Slots wait on the network: CPU was 40% and memory 31% at 4×. At 32 slots step 2× is NO-SHIP (queue 347); at 128 it is SHIP (queue 3), and 4× passes too, still on one instance. The next ceiling is predicted at about 37.6 grades/s.
- **Assumption:** OpenRouter and its upstream providers accept 128 concurrent calls; the canary only proved about 5/s.
- **Deferred:** scaling workers on queue depth.

## Smaller decisions

### Product

**D-02 One attempt per problem.** Students redraw freely before submitting; after that they can view the problem but not resubmit. This is grading, not practice, so the score can't be gamed toward the answer, and spend is about one call per student per problem. The one exception is work the grader couldn't read: the student rewrites it once, as attempt 2 of the same submission (D-06). "One try per problem" sits beside the button. *Deferred: a confirmation step before submit, and teacher-granted retries.*

**D-03 Problem format.** Text with inline `$…$` math (KaTeX), an optional answer key, 1–10 integer points per problem, 1–10 problems per assignment. *Deferred: upload-and-extract from a photo or PDF, a separate model pipeline with its own eval.*

**D-05 The teacher sees the assignment before the editors.** A new assignment opens as an overview: each problem with its points and a read-only list of its criteria, and "Edit rubric" opens one editor at a time. A starter template opens ready to fill in. The report answers "what do I do tomorrow?": a live students × problems grid (not started, grading…, score, rewriting ↻, needs review ⚑, teacher-adjusted ✎), class completion, per-problem averages with n, "What the class missed" by criterion, and a review queue ranked by risk.

**D-07 Budget read from the source.** The OpenRouter key has a fixed credit balance, read from its `/key` endpoint rather than assumed. The budget guard refuses model-spending jobs below a $5 floor, and eval and canary runs print a projected cost before spending. Total key usage across the project is about $0.27.

**D-08 Rubrics drafted when a problem is saved.** A blocking 3–8 s call to a stronger text model (`openai/gpt-6.1-terra`, under $0.01 per problem), because every grade inherits the rubric. If it fails, the teacher gets an editable starter template.

**D-09 One-click sample.** "Try a sample assignment" creates a three-problem Algebra 1 assignment from the eval's reviewed problems and rubrics, with no model call, so it's instant and free.

**D-10 Rubric edits are versioned.** Grades keep the rubric version they used, and the report marks "graded with an earlier rubric" (↺). *Deferred: re-grading affected submissions from the stored transcription.*

### Grading engine

**D-13 Strokes are the source of truth.** The client renders a cropped grayscale PNG (≤ 1024 px, ≤ 256 KB, magic-byte checked) from the strokes. The PNG is cleared once a submission is final; strokes stay, and the teacher view re-renders from them.

**D-14 A thin hand-rolled model client.** About 150 lines over Effect's `HttpClient`. `@effect/ai-openrouter` doesn't pass through OpenRouter's `usage.cost`, which is authoritative. Strict JSON Schema output reuses Effect's own OpenAI codec.

**D-15 A `model_call` ledger.** Every call, including failures: purpose, model, provider, status, tokens, cost, latency, error kind. The budget guard, 429 rates and load-test analysis all query it.

**D-16 Effect 4.1.2 from the canonical repo.** `effect-smol` was archived at a beta, so all `effect` / `@effect/*` packages are pinned to 4.1.2 and APIs are checked against `Effect-TS/effect` at that tag.

**D-17 TypeScript 7 with `@effect/tsgo`.** Effect's diagnostics fail `tsc`, not just the editor.

### Eval

**D-18 Gold set drawn in the app's own whiteboard.** Per-criterion ground truth, labelled by hand: 20 cases on 3 problems, plus the 3-case hard set (D-30). The same drawings are the load test's payloads. *Deferred: a larger gold set across more problems.*

**D-29 Eval method.** Models are compared at live list price from measured tokens, because OpenRouter billed some calls at $0 and would have made a mid-priced model look free. Summaries can be rebuilt from saved results without paying again (`evals/src/rescore.ts`).

### Load test and infrastructure

**D-20 Cloud Run and Neon.** Vercel, Cloudflare Workers, Render, Koyeb, Hugging Face, Oracle and Fly were each ruled out on their own docs (load-testing terms, CPU limits, sleep, cost). Cloud Run gives always-on CPU and a hard instance cap; Neon gives managed Postgres that scales to zero. What this runtime requires is listed under D-28.

**D-21 A custom open-model load generator, not k6.** It replays a testing-day timeline (staggered class starts, joins, lognormal think time, polling), scores latency from each request's scheduled send time, and gates on its own lag (`loadtest/`).

**D-23 Real-model canary on prod.** 50 real grades through the deployed path, tagged and cleaned up. Real latency (p50 2.8 s) was about 20% faster than the simulator's; no 429s or 5xx; cost $0.009.

**D-24 Polling with backoff, not SSE.** Students poll 2 → 8 s only while a score is pending; the report polls 10 → 30 s; both stop in hidden tabs. Polls answered in p99 73 ms at 4× load. *Deferred: ETags, then push updates (SSE).*

**D-25 Tests on real Postgres.** `@effect/vitest`, with queue tests (claim, lease, sweeper, idempotency) against real Postgres, because `SKIP LOCKED` and lease semantics can't be mocked honestly. They run in CI.

**D-26 Plain `.sql` migrations.** Run by Effect's migrator, and expand-only: 0006 kept the old `show_criteria` column rather than dropping it.

**D-27 The idle worker sleeps until it's needed.** With nothing claimable, the worker sleeps until the earliest of: a wake from the API on submit, the next due retry or lease expiry, or a long idle poll. An idle system issues almost no queries, so Neon can scale to zero, and a submit still starts grading immediately.

**D-31 Load-test safeguards.** Database transfer is measured per submission and projected before each run, because Neon Free allows 5 GB/month shared with production; that measurement caught student polls carrying submitted drawings, which are now fetched once. Leases are 30 s with a 10 s heartbeat, because a 60 s lease left stranded jobs waiting up to 66 s after a crash. The crash endpoint returns 404 unless the deploy is made with `ops/deploy.sh --chaos`.
