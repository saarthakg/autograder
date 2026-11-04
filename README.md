# Goblins Auto-Grader

A teacher types a few math problems and gets an editable, AI-drafted rubric. Students show their work on a whiteboard and see a score per problem a few seconds after submitting, without ever waiting on the grader. The teacher gets a live report: who's done, what the class missed, and which answers are worth a second look, each with the model's evidence and a one-click override.

**Live:** https://autograder-768677959450.us-east4.run.app

**Sample class set up for reviewers:**
- **Teacher:** https://autograder-768677959450.us-east4.run.app/t#k=ra8F54Zo8LWoUTegBHKgqw (anyone with this link sees this one class).
- **Students:** https://autograder-768677959450.us-east4.run.app/join?code=GNKBVE (class code **GNKBVE**). Use a private window, so the two sessions stay separate.

### 60-second demo

1. **Teacher.** Click **Try a sample assignment**, look over the three rubrics, and click **Publish and get a class code**.
2. **Student.** Click **Copy student link** and open it in a private window. Join with a name, draw your work on problem 1, and click **Submit**. **Next problem →** works at once, and the score appears a few seconds later.
3. **Teacher.** The report has updated. Click the score to see the transcription, each criterion's evidence and the model that graded it. Override a verdict, and the student's view follows.

## The core slice

Each step, and the product decision behind it. The reasoning and trade-offs for each are in [`DECISIONS.md`](DECISIONS.md).

1. **Create:** problems as text with `$…$` math, or a one-click sample that makes no model call.
2. **Rubric:** a stronger model drafts yes-or-no criteria. The model judges each criterion; code adds up the points, so the model never sees them.
3. **Publish:** a class code, and no accounts. Teachers keep a private link, and students get a rejoin code for other devices.
4. **Work:** a whiteboard, and one attempt per problem, because this is grading, not practice.
5. **Score:** submit returns at once and grading runs on a queue. Students see their score and what they got right, never hints.
6. **Report:** a live grid, the class's most-missed criteria, and a review queue ranked by risk. Unreadable work says "Your teacher will check this one" instead of guessing.

## Where the extra depth went, and why

Two questions decide whether a teacher can rely on this: is a cheap model accurate enough, and does the system hold up on a busy testing day?

**Accuracy on cheap models.** On 20 hand-drawn cases × 3 runs, `openai/gpt-6-luna` matched the `gpt-6.1-sol` reference at **$0.00023 per grade, about 1/16 of the cost**:
- 100% criterion accuracy
- no false full credit
- 0% flip rate between runs

The gates discriminate: Qwen3-VL failed four of them ([results](evals/results/2026-11-03T05-10-14-515Z/summary.md)). A 3-case hard set then caught the first-choice fallback, Gemini Flash Lite, "reading" an unreadable scribble and awarding 3/4 on every run. So the fallback became `gpt-6.1-sol`, and every grade records which model served it. With n = 20, the intervals' lower bounds sit near 83%.

**Trust under load.**
- **SHIP at the load of 1,200 students** (peak 6.9 submits/s): 0 lost, time to grade p95 4.9 s.
- **One setting moved the breakpoint:**
  - The first break was 9.3 grades/s, because 32 worker slots ÷ 3.4 s per call caps one instance (Little's law).
  - At 128 slots, the load of **about 4,800 students** passes on the same single instance.
- **Killing the instance mid-run lost nothing.**
- **Caveat:** the simulator tests our system, not the provider. The real-model canary only proved about 5 calls/s.

The statement of confidence, the 1k → 1M ladder and the bug the load test caught are in [`LOADTEST.md`](LOADTEST.md).

## What I'd do next

In order of value:

1. Scale the worker on queue depth instead of HTTP traffic, the first move at 10k students.
2. Per-district fair queuing and multi-provider routing for the model calls.
3. A confidence cascade: re-grade low-confidence results with the stronger model.
4. Re-grade on rubric edit, re-scoring from the stored transcription.
5. Sync in-progress drafts across devices.
6. Worksheet PDF or photo upload that turns into problems.
7. Stroke replay and misconception clustering in the report.

## What we left out and why

These are deferrals, not unknowns:

- **Submit confirmation.** "You get one try per problem" sits beside the button instead.
- **Teacher-granted retries.** The schema already allows a second attempt; there's no UI for it yet.
- **A larger gold set.** The eval uses 20 cases on 3 problems plus a 3-case hard set; more cases would tighten the intervals.
- **ETags on polls.** Polls stayed at p99 73 ms under 4× load, so caching wasn't needed yet; push updates (SSE) come after.
- **Production hardening:** a separate load-test environment, so runs never share prod; Secret Manager, least-privilege IAM and budget alerts.

## Run locally

Needs Bun 1.4 and Docker.

```sh
bun install
docker compose up -d --wait                      # Postgres 17 (dev + test DBs)
cp .env.example .env                             # add OPENROUTER_API_KEY for real grading
bun run migrate
bun run build && bun run dev                     # http://localhost:3000
bun run typecheck && bun run test                # in a second terminal
```

Without a key, everything but model calls works: the sample needs no model, and submissions go to "Your teacher will check this one".

The other commands:
- `bun run eval`: shows the projected cost; add `--yes` to run it.
- `bun run loadtest --scenario testing-day --target <url>`: spends $0 on models and cleans up after itself.
- `./e2e/run.sh [url]`: browser tests. They're not in CI, because one grades a submission for real.
- `ops/deploy.sh [--project ID] [--region REGION] [--chaos]`: deploys to Cloud Run (project and region also read from `GCP_PROJECT` / `GCP_REGION`).

Built with Claude Code; how I directed it is in [`AGENTS.md`](AGENTS.md).
