# Goblins Auto-Grader

A teacher creates an assignment and gets an editable AI-drafted rubric. Students show their work on a whiteboard and get scored per problem, without waiting on the grader. The teacher gets a live report that says what to do tomorrow.

**Live:** https://autograder-768677959450.us-east4.run.app

**Sample class set up for reviewers:**
- **Teacher:** https://autograder-768677959450.us-east4.run.app/t#k=ra8F54Zo8LWoUTegBHKgqw. Opens the class report; anyone with this link sees this one class.
- **Students:** https://autograder-768677959450.us-east4.run.app/join?code=GNKBVE (class code **GNKBVE**). Open it in a private window, so the student and teacher sessions stay separate.

## 60-second demo

1. **Teacher (0–15 s).** Open the live URL and click **Try a sample assignment**. You land on three Algebra 1 problems, each with a reviewed rubric of binary criteria. Edit any criterion if you like, then click **Publish and get a class code**.
2. **Student (15–45 s).** Click **Copy student link** and open it in a private window. Type a name and click **Join**. Draw your work on problem 1 with a mouse, trackpad or stylus (`3x − 6 = 2x + 5` → `x = 11`) and click **Submit**. You see your drawing beside "Grading…", and **Next problem →** works at once. A few seconds later the score fills in, with the criteria you met.
3. **Teacher again (45–60 s).** Back in the first window, the report has updated: the student's score, class averages, **What the class missed**, and a review queue ranked by risk. Click a score to see the transcription, each criterion's evidence and, under **Grading details**, the model that graded it. Override any verdict; the student's view follows.

To try your own problems, click **Create your own**. The rubric is drafted by a model in a few seconds.

## Headline decisions

The full log, with every entry's final status, is in [`DECISIONS.md`](DECISIONS.md).

- **Feedback off still shows what went right (D-01).** By default a student sees their score and the criteria they met, never the answer or hints. The teacher can pick score only, or add a gentle "Not yet" for unmet criteria.
- **One attempt per problem (D-02).** This is grading, not practice, so the score can't be gamed toward the answer, and model spend is one call per student per problem.
- **No accounts (D-04).** Teachers get a private capability link; students join with a class code and get a rejoin code for other devices. Secrets live in the URL fragment and only their hashes are stored.
- **Binary criteria; the model judges, code adds up (D-11).** The model transcribes the work, says whether it's legible, and marks each criterion met or not with evidence. It never sees points. Code computes the score and ranks what the teacher should check.
- **Honest when unsure (D-06).** Illegible work or a failed grade shows "Your teacher will check this one", never a made-up score.
- **Grading is a Postgres queue (D-12).** Submit commits the work and a job in one transaction and returns at once. Workers claim jobs with `SKIP LOCKED` and leases renewed by a heartbeat, so a crashed instance loses nothing.
- **The cheapest model that clears an agreed bar (D-19, D-30).** `openai/gpt-6-luna` costs $0.00023 per grade, a sixteenth of the reference, and matched it on the eval. A hard set caught the planned fallback crediting an unreadable scribble, so the fallback became `gpt-6.1-sol`.
- **One public service, tested where it runs (D-28).** One Cloud Run service runs the API, web app and worker, backed by Neon Postgres. The load test runs against that same URL, with an in-process model simulator.
- **Worker slots sized by Little's law (D-32).** Raising the slots from 32 to 128 moved the first breakpoint from ~1,600 to beyond 4,800 students.

## Results

**Model eval:** on 20 hand-drawn cases × 3 runs, Luna matched the strong reference with 100% criterion accuracy, no false full credit, and a 0% flip rate. [Details below.](#model-eval-which-cheap-model-can-grade)

**Load test** ([`LOADTEST.md`](LOADTEST.md), the statement of confidence):

| Scenario | Load | Result |
|---|---|---|
| Testing day | rate-equivalent to 40 classes / 1,200 students, peak 6.9 submits/s | SHIP: 0 lost, submit p99 95 ms, time to grade p95 4.9 s |
| Breakpoint 4× | ~4,800 students, 25.8 submits/s | SHIP on one instance, time to grade p95 4.9 s; next ceiling ~37 grades/s |
| Chaos | instance killed mid-run | SHIP: 0 lost, stranded jobs back within 30 s |
| Canary | 50 real grades in 10 s | Real model ~20% faster than the simulator; no 429s or 5xx; $0.009 |

Everything above 5 calls/s assumes OpenRouter accepts the concurrency, because the canary only proved ~5/s. Re-run with `bun run loadtest --scenario testing-day --target <url>`. It spends $0 on models and cleans up after itself.

## What was left out, and why

Each part had a budget of about 75 minutes, so the product flow and the evidence behind it came first (D-28).

- **Problems from a photo or PDF (D-03).** That's a second model pipeline with its own eval. Typing three problems takes a minute.
- **Re-grade after a rubric edit (D-10).** Grades keep the rubric version they used and are marked ↺, but there's no "re-grade affected" button yet.
- **Teacher-granted retries (D-02).** The schema has the `attempt` column; the UI doesn't.
- **A confidence cascade (D-19).** The eval found no grading errors, so we couldn't measure whether `low` confidence predicts them. Low-confidence grades are ranked for review instead.
- **Push updates and ETags (D-24).** Students and the report poll with backoff, and polls answered in p99 73 ms under load.
- **Cross-device draft sync.** Unsubmitted work is kept in the browser per student and problem. Switching devices mid-problem starts that problem blank; everything submitted follows the student.
- **Production hardening (D-28).** These were cut:
  - a separate load-test environment and deployed fake model
  - a worker that scales on its own
  - Secret Manager, least-privilege IAM and budget alerts
  - a scheduled load-test workflow
  - a fuller chaos suite

## What's next

1. **A worker that scales on queue depth.** Cloud Run scales on HTTP traffic and can't see the queue. This is the first move at 10k students.
2. **A sustained real-provider test at 30+ calls/s,** with OpenRouter's limits confirmed in writing.
3. **Grow the gold set from teacher overrides.** Every override is stored as labelled data. Then add phone photos of paper, which is where published LLM grading fails most.
4. **Re-grade affected, teacher-granted retries, and push updates (SSE).**

## Run locally

Needs Bun 1.4 and Docker.

```sh
bun install
docker compose up -d --wait                      # Postgres 17 (dev + test DBs)
cp .env.example .env                             # add OPENROUTER_API_KEY for real grading
(cd apps/server && bun --env-file=../../.env src/migrate.ts)
bun run build && bun run dev                     # http://localhost:3000
bun run typecheck && bun run test                # in a second terminal
```

Without `OPENROUTER_API_KEY`, everything runs except model calls. The sample assignment needs no model, and a submission ends up as "Your teacher will check this one".

- **Layout:** `apps/server` (Effect 4 on Bun: API, worker, migrations), `apps/web` (React), `packages/domain` (shared schemas and API), `evals/`, `loadtest/`, `e2e/`, `prompts/` (versioned prompts), `ops/deploy.sh`.
- **Deploy:** `ops/deploy.sh` builds, migrates and deploys the Cloud Run service. `--chaos` enables the crash endpoint for a chaos run; without it, the script refuses `ENABLE_CHAOS`. It also validates tuning overrides (`JOB_LEASE="30 seconds"`, `MODEL_CONCURRENCY=128`) before building.

### Browser tests (not in CI)

```sh
./e2e/run.sh                                     # against http://localhost:3000
./e2e/run.sh https://<deployed-url>              # against a deployment
```

These are Playwright regressions for the "broken" findings from the outsider UI review:
- drafts surviving a refresh, a problem switch and a shared Chromebook
- the list and report agreeing after hand-grading
- unsaved rubric edits never being dropped

They draw with real pointer input. Each run records the workspaces it creates in `e2e/.runs/<run_id>.jsonl` so they can be deleted afterwards. They need a live server, and one test grades a submission for real (about $0.0002), so CI doesn't run them.

## Model eval: which cheap model can grade?

**The cheap tier matches the reference on clean digital ink at a sixteenth of the cost.** `openai/gpt-6-luna` grades at **$0.00023** per submission. The strong reference, `openai/gpt-6.1-sol`, costs **$0.00363**. On our gold set they scored the same.

### How it was measured

- **Gold set:** 20 cases, hand-drawn in the app's own whiteboard (`/dev/fixtures`), across three Algebra 1 problems:
  - correct standard method
  - correct alternative method
  - arithmetic slip
  - conceptual error
  - answer only
  - messy work with crossed-out attempts
  - unreadable or restated problem

  Each case has per-criterion gold verdicts.
- **Grader under test:** the production one. That means the same `grade.v2` prompt, the strict JSON schema, and the one-retry-then-`needs_review` rule. Each model graded every case 3 times.
- **Metrics:** each comes with a Wilson 95% interval. They're computed with n = distinct cases, not runs, because the three runs of one drawing are correlated.
- **Cost:** compared at live list price from measured tokens (D-29).

| Model | Exact total | Criterion accuracy | Flip rate (k=3) | Schema-valid | p95 latency | Cost / grade | Gates |
|---|---|---|---|---|---|---|---|
| **openai/gpt-6-luna** (chosen) | 100% [84–100] | 100% [83–100] | 0% | 100% | 4.5 s | $0.00023 | 7/7 |
| google/gemini-3.1-flash-lite (removed as fallback, see below) | 100% [84–100] | 100% [83–100] | 0% | 100% | 2.3 s | $0.00092 | 7/7 |
| deepseek/deepseek-v4.1-flash | 100% [84–100] | 100% [83–100] | 0% | 100% | 4.8 s | $0.00022 | 7/7 |
| qwen/qwen3-vl-30b-a3b-instruct | 83% [62–94] | 88% [67–97] | 25% | 92% | 9.9 s | $0.00036 | 3/7 |
| openai/gpt-6.1-sol (reference) | 100% [84–100] | 100% [83–100] | 0% | 100% | 3.9 s | $0.00363 | 7/7 |

- No model gave false full credit, and only Qwen gave a false zero (2%).
- Luna was picked over DeepSeek because DeepSeek returned empty responses on 3% of calls.
- Full results, with every wrong case and the model's transcription: [`evals/results/2026-11-03T05-10-14-515Z/summary.md`](evals/results/2026-11-03T05-10-14-515Z/summary.md).

### The eval discriminates

Qwen3-VL 30B failed in ways that matter for grading:

- **Misread strike-throughs.** It didn't mark crossed-out lines in its transcription, so on both messy cases it treated the struck-through wrong step as real work and withheld a criterion the student earned.
- **Misjudged carried-forward credit.** On one run it withheld credit for a correct step that followed from the student's own earlier slip.
- **Broke the output contract.** On the answer-only cases, even after the corrective retry, it invented a criterion, judged one twice, or wrote overlong evidence. Those submissions would go to the teacher instead of being graded.
- **Was unstable.** On a quarter of cases, the total changed between identical runs.

So the gates separate a reliable cheap model from an unreliable one. They aren't trivially passed.

### Caveat: n = 20

Twenty cases is small. With every top model at 100%, the lower bounds of the intervals sit around 83–84%. This result shows the cheap tier holds up on clean digital ink, but it can't rank the top models against each other or promise 99% accuracy in the wild.

The input is also easier than phone photos of paper: clean black ink on a white canvas, cropped to the strokes. Most published failures of LLM grading are reading errors on noisy images (Levine et al., UIUC 2026; FERMAT, ACL 2025).

Every teacher override in the product is stored as labelled data, so the gold set can keep growing from real use.

### The hard set caught the fallback inventing work (D-30)

Three harder cases at k=3: right answer with wrong work, sloppy but correct work, and a truly unreadable scribble.

| Model | Exact total | Abstains on unreadable | Cost / grade |
|---|---|---|---|
| **openai/gpt-6-luna** (chosen) | 9/9 | 3/3 | $0.00022 |
| google/gemini-3.1-flash-lite | 6/9 | **0/3** | $0.00094 |
| openai/gpt-6.1-sol (now the fallback) | 9/9 | 3/3 | $0.00323 |

Gemini cleared every gate on the 20-case set. On the scribble, it "read" `3x - 6 11` all three times and awarded 3 of 4 points. Confident credit for unreadable work is the worst error this product can make, because the teacher never sees it. So Gemini was removed as fallback.

Grading now goes: Luna on OpenAI → Luna on Azure (then Luna's other providers) → `gpt-6.1-sol`. All of it is OpenRouter config (`GRADING_PROVIDER_ORDER`, `GRADING_FALLBACK_MODELS`). At an assumed 2% fallback rate the blended cost is $0.00030/grade. Every grade records which model and provider served it, and the teacher's review drawer shows them.

Three cases is a smoke test for failure modes, not an accuracy measure: [`summary.md`](evals/results/2026-11-04T02-59-09-733Z/summary.md).

Re-run it with `bun run eval`. That prints a projected cost and spends nothing; add `--yes` to run it.
