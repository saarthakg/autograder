# Goblins Auto-Grader

An AI auto-grader for handwritten math. A teacher types a few problems and receives an editable, AI-drafted rubric. Students show their work on a whiteboard and see a score per problem a few seconds after submitting, without waiting on the grader. The teacher gets a live report: who has finished, what the class missed, and which answers are worth a second look, each with the model's evidence and a one-click override.

**Live:** https://autograder-768677959450.us-east4.run.app

**Sample class for review:**
- **Teacher:** https://autograder-768677959450.us-east4.run.app/t#k=ra8F54Zo8LWoUTegBHKgqw (anyone with this link can see this class).
- **Students:** https://autograder-768677959450.us-east4.run.app/join?code=GNKBVE (class code **GNKBVE**). Use a private window so the two sessions stay separate.

### 60-second demo

1. **Teacher.** Click **Try a sample assignment**, review the three rubrics, and click **Publish and get a class code**.
2. **Student.** Click **Copy student link** and open it in a private window. Join with a name, draw the work for problem 1, and click **Submit**. **Next problem →** is available immediately, and the score appears a few seconds later.
3. **Teacher.** The report updates. Click the score to see the transcription, each criterion's evidence and the model that graded it. Overriding a verdict updates the student's view.

## How it works

Each step of the flow, and the product decision behind it. Reasoning and trade-offs are recorded in [`DECISIONS.md`](DECISIONS.md).

1. **Create:** problems as text with `$…$` math, or a one-click sample that makes no model call. The assignment opens as an overview of its problems and rubrics; editors open on request.
2. **Rubric:** a stronger model drafts yes-or-no criteria. The grading model judges each criterion; code adds up the points, so the model never sees them.
3. **Publish:** a class code, with no accounts. Teachers keep a private link; students receive a rejoin code for other devices.
4. **Work:** a whiteboard that fills the screen, and one attempt per problem, because this is grading, not practice.
5. **Score:** submit returns immediately and grading runs on a queue. Students see their score, what they did, and what's not there yet; never the answer or hints.
6. **Resolve:** an unsure, unreadable or malformed grade is re-graded by a stronger model; work still unreadable goes back to the student to rewrite once. Only what's left reaches the teacher.
7. **Report:** a live grid, the class's most-missed criteria, and a short review queue ranked by risk.

## Evidence

Two questions determine whether a teacher can rely on the system: whether a cheap model grades accurately enough, and whether the system holds up on a busy testing day.

**Accuracy on cheap models.** On 20 hand-drawn cases × 3 runs, `openai/gpt-6-luna` matched the `gpt-6.1-sol` reference at **$0.00023 per grade, about 1/16 of the cost**:
- 100% criterion accuracy
- no false full credit
- 0% flip rate between runs

The gates discriminate: Qwen3-VL failed four of them ([results](evals/results/2026-11-03T05-10-14-515Z/summary.md)). A 3-case hard set then showed Gemini Flash Lite, the first candidate for fallback, "reading" an unreadable scribble and awarding 3/4 on every run, so `gpt-6.1-sol` is the fallback ([results](evals/results/2026-11-04T02-59-09-733Z/summary.md)). Every grade records which model served it. With n = 20, the lower bounds of the 95% intervals sit near 83%.

**Behaviour under load.**
- **Testing-day load of 1,200 students** (peak 6.9 submits/s) passes every SLO: 0 lost, time to grade p95 4.9 s.
- **Breakpoint:** with 32 worker slots, one instance grades at most 9.3/s (32 slots ÷ 3.4 s per call, by Little's law). At 128 slots, the load of **about 4,800 students** passes on the same single instance.
- **Instance killed mid-run:** no work lost.
- **Caveat:** the simulator exercises this system, not the provider. The real-model canary covers about 5 calls/s.

The statement of confidence, the 1k → 1M scaling table and a bug the load test caught are in [`LOADTEST.md`](LOADTEST.md).

## Roadmap

In order of value:

1. Scale the worker on queue depth instead of HTTP traffic; this is the first change needed at 10k students.
2. Per-district fair queuing and multi-provider routing for model calls.
3. Re-grade on rubric edit, re-scoring from the stored transcription.
4. Sync in-progress drafts across devices.
5. Worksheet PDF or photo upload that becomes problems.
6. Stroke replay and misconception clustering in the report.

## Known limitations

- **No submit confirmation.** "You get one try per problem" is shown beside the button instead.
- **No teacher-granted retries.** A second attempt exists only to rewrite unreadable work; there is no UI for a teacher to grant one.
- **Small gold set.** The eval uses 20 cases on 3 problems plus a 3-case hard set; more cases would tighten the intervals.
- **Plain polling.** Polls answered in p99 73 ms under 4× load, so ETags and push updates (SSE) are not yet needed.
- **Shared environment.** Load tests run against production, tagged and cleaned up. Secret Manager, least-privilege IAM and budget alerts are not yet configured.

## Development

Requires Bun 1.4 and Docker.

```sh
bun install
docker compose up -d --wait                      # Postgres 17 (dev + test databases)
cp .env.example .env                             # add OPENROUTER_API_KEY for real grading
bun run migrate
bun run build && bun run dev                     # http://localhost:3000
bun run typecheck && bun run test                # in a second terminal
```

Without an API key, everything except model calls works: the sample needs no model, and submissions go to "Your teacher will check this one".

Other commands:
- `bun run eval`: prints the projected cost; add `--yes` to run it.
- `bun run loadtest --scenario testing-day --target <url>`: spends $0 on models and cleans up after itself.
- `./e2e/run.sh [url]`: browser tests. They are not in CI because one test grades a submission with the real model.
- `ops/deploy.sh [--project ID] [--region REGION] [--chaos]`: deploys to Cloud Run (project and region can also come from `GCP_PROJECT` / `GCP_REGION`).

Built with Claude Code; the development process is described in [`AGENTS.md`](AGENTS.md).
