# Load test: statement of confidence

**Ship for testing day at up to ~1,600 students working at once on the deployed URL as it stands.** That is about 9 submits/s at peak. Above that, grading falls behind, but nothing is lost, and the backlog drains as soon as the burst ends. The first limit is one config value plus how Cloud Run scales, not hardware.

Re-run any of this with one command. Default runs spend $0 on models and clean up after themselves:

```sh
bun run loadtest --scenario testing-day --target https://autograder-768677959450.us-east4.run.app
```

## What it handles today (measured on the public URL, 2026-11-04)

| Run | Load | Verdict | What happened |
|---|---|---|---|
| [testing-day](loadtest/reports/lt-testing-day-202611040520/report.md) | 40 classes, **1,200 students** × 10 problems, starts staggered over 15 min; peak **6.9 submits/s** | **SHIP** | 3,000/3,000 graded, 0 lost. Submit p99 95 ms. Time to grade p95 4.9 s, p99 7.2 s. Queue never above 2. |
| [step 2×](loadtest/reports/lt-step-x2-202611040538/report.md) | **14 submits/s** held ~3.5 min | **NO-SHIP** | Time to grade p95 39.8 s, queue peaked at 347. Still 0 lost, submit p99 108 ms, drained 3 s after the last submit. |
| [chaos, 60 s lease](loadtest/reports/lt-chaos-lease60-202611040546/report.md) | testing-day + the serving instance killed abruptly mid-run | **SHIP** | 0 lost. One submit got a 503 and succeeded on the client's retry. Stranded jobs waited out the lease: time to grade max 66 s. |
| [chaos, 30 s lease + 10 s heartbeat](loadtest/reports/lt-chaos-lease30-202611040610/report.md) | same | **SHIP** | 0 lost; 2 submits (one 500, one 503) succeeded on retry. Stranded jobs came back in ≤ 30 s: time to grade max **38 s** (was 66 s), oldest waiting job 30 s (was 61 s). The heartbeat keeps slow model calls safe while cutting crash recovery in half. |
| [canary](loadtest/reports/lt-canary-202611040545/report.md) | 50 **real** grades in a 10 s burst (~5/s) | **SHIP** | Real model p50 2.8 s, p95 3.5 s. No 429s or 5xx. Cost $0.009. |

Every run checks every acknowledged submit against Postgres (the lost-work invariant). Time to grade comes from the server's own clock (`graded_at − accepted_at`). Latency is scored from each request's *scheduled* send time, and a run is INVALID rather than PASS if the generator itself lagged. All runs above were valid: lag p99 ≤ 13 ms. Cold starts are measured and reported, but kept out of the SLOs (D-22).

## Where it breaks first, and why

Grading throughput is flat at **9.3 grades/s**, with exactly **32 jobs running** at once. That is Little's law on one instance: 32 worker slots (`MODEL_CONCURRENCY`) ÷ ~3.4 s per model call ≈ 9.4/s. Cloud Run never added a second instance, because it scales on HTTP traffic, and submits and polls are cheap (submit p99 stayed near 100 ms). The worker's backlog is invisible to the autoscaler. Above ~9 submits/s, the queue grows at (arrival − 9.3)/s, and every new submit waits behind it.

Cheapest fixes, in order:
1. Raise `MODEL_CONCURRENCY`. Slots spend their time waiting on the network, not using CPU.
2. Keep a minimum instance count on testing days.
3. Split the worker into its own service that scales on queue depth. This is in the cut list below.

Nothing else was close to its limit. The database answered polls in about 55 ms, and there were no submit errors outside the deliberate crash.

## How much to trust it

- **The simulator tests our system, not the provider.** Queue, worker, retries and backoff, leases, Postgres and HTTP all run for real. Only the model's network hop is simulated, with latency fitted to the eval and injected 429s (2%), 5xx (1%) and invalid output (0.5%).
- **Simulator vs reality:** the canary's real latency (p50 2.8 s, p95 3.5 s) is ~20% *faster* than the simulator's (3.4 s, 4.5 s), so the capacity numbers above are conservative. Caveat: the load test uses the smallest drawings to save database transfer, and small images grade faster.
- **What the canary can't tell us:** whether OpenRouter rate-limits us at a *sustained* 9+ calls/s. It saw no 429s in a 10 s burst at 5/s.
- **The load generator** is one laptop over the public internet, so client latencies include that network hop. Speed N runs 1/N of the classes N× faster, which keeps the arrival rate equal to the real-world scenario. It doesn't create the full count of student rows.
- **Shared with prod:** runs share the prod instance and the Neon database, tagged by `run_id` and deleted afterwards. Each run projects its database transfer before it starts (Neon Free: 5 GB/month). Measured at ~35 KB per submission, so this whole campaign used about 0.4 GB (smoke, testing-day, one breakpoint step, two chaos runs, the canary).

## 1k → 1M students (Little's law, measured inputs)

Inputs:
- Peak arrival ≈ **0.0058 submits/s per student** (testing-day: 6.9/s for 1,200 students).
- Model call ≈ **3.4 s**, so calls in flight = arrival × 3.4.
- Cost ≈ $0.0003 per grade (D-30), ×10 problems per student.

| Students at once | Peak submits/s | Model calls in flight | What has to change | Model cost per testing day |
|---|---|---|---|---|
| **1,000** | 6 | ~20 | Nothing: today's deploy (measured ceiling ~1,600). | ~$3 |
| **10,000** | 58 | ~200 | Worker as its own service scaled on queue depth (~7 × 32 slots, or fewer with more slots each); `MODEL_MAX_IN_FLIGHT` raised to ~250; confirm OpenRouter's rate limit for that concurrency; paid Neon. | ~$30 |
| **100,000** | 580 | ~2,000 | Provider capacity becomes the constraint: several providers and keys, negotiated limits. Images to object storage instead of Postgres. Queue on a partitioned table or a managed queue. Polling (~3,000 req/s) moves to push (SSE) or cached status. | ~$300 |
| **1,000,000** | 5,800 | ~20,000 | Dedicated model throughput, or a self-hosted grader for the common cases; per-district sharding of Postgres; event-driven status; multi-region. Caching identical answers (answer-only submissions repeat) cuts calls. | ~$3,000 |

## Next steps (cut for time, D-28)

- Worker split from the API, autoscaled on queue depth. This is the fix for the first bottleneck above.
- A separate load-test environment: its own Neon project and a deployed fake-LLM, so runs never share prod.
- A breakpoint search that ramps automatically instead of fixed steps; a GitHub Actions `workflow_dispatch` for scheduled runs.
- A fuller chaos suite: database failover, a full provider outage on the fallback path, network partitions.
- Secret Manager, least-privilege IAM, and budget alerts for production.
