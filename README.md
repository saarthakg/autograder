# Goblins Auto-Grader

A teacher creates an assignment and gets an editable AI-drafted rubric. Students show their work on a whiteboard and get scored per problem, without waiting on the grader. The teacher gets a report.

**Live:** https://autograder-768677959450.us-east4.run.app

> The full README (60-second demo path, headline decisions, what we left out and why, what's next) arrives in the final phase. The decision log is in [`DECISIONS.md`](DECISIONS.md); the design is in [`docs/PLAN.md`](docs/PLAN.md).

## Run locally

```sh
bun install
docker compose up -d --wait                      # Postgres 17 (dev + test DBs)
cp .env.example .env                             # add OPENROUTER_API_KEY for real grading
(cd apps/server && bun --env-file=../../.env src/migrate.ts)
bun run build && bun run dev                     # http://localhost:3000
bun run typecheck && bun run test
```

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
| google/gemini-3.1-flash-lite (fallback) | 100% [84–100] | 100% [83–100] | 0% | 100% | 2.3 s | $0.00092 | 7/7 |
| deepseek/deepseek-v4.1-flash | 100% [84–100] | 100% [83–100] | 0% | 100% | 4.8 s | $0.00022 | 7/7 |
| qwen/qwen3-vl-30b-a3b-instruct | 83% [62–94] | 88% [67–97] | 25% | 92% | 9.9 s | $0.00036 | 3/7 |
| openai/gpt-6.1-sol (reference) | 100% [84–100] | 100% [83–100] | 0% | 100% | 3.9 s | $0.00363 | 7/7 |

- No model gave false full credit, and only Qwen gave a false zero (2%).
- Luna was picked over DeepSeek because DeepSeek returned empty responses on 3% of calls. Gemini is the configured fallback, through OpenRouter's model routing.
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

A small **hard set** was added to probe harder cases: right answer with wrong work, sloppy handwriting, and truly unreadable work. Every teacher override in the product is stored as labelled data, so the gold set can keep growing from real use.

Re-run it with `bun run eval`. That prints a projected cost and spends nothing; add `--yes` to run it.
