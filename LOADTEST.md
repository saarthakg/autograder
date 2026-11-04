# Load test

## Statement of confidence

**The deployed system handles at least the load of ~4,800 students working at once (25.8 submits/s), measured on the public URL with no lost work. The next predicted ceiling is ~6,500 students (~37 grades/s).** A testing day of 1,200 students uses about a quarter of that.

The model provider is proven to a lower rate. The real-model canary graded cleanly through OpenRouter at **~5 calls/s**. Everything above that assumes OpenRouter and its upstream providers (OpenAI, Azure) accept up to 128 concurrent calls from one key. That is untested, and it is the first thing to confirm before a large testing day.

## Running it

Each run is one command. Default runs spend $0 on models and clean up after themselves:

```sh
bun run loadtest --scenario testing-day --target https://autograder-768677959450.us-east4.run.app
bun run loadtest --scenario step --scale 4 --target https://autograder-768677959450.us-east4.run.app
```

The CLI reads `ADMIN_TOKEN` from `.env` (or `--admin-token`) and drives the admin endpoints under `/api/admin/loadtest/*` (create tagged classes, read queue metrics, analyze a run, delete it); every one of them requires that token as a Bearer header.

Load-test assignments are graded by an in-process model simulator with latency fitted to the eval (p50 3.4 s, p95 4.5 s) and injected 429s (2%), 5xx (1%) and invalid output (0.5%). Everything else runs for real: HTTP, Postgres, the queue, the worker, retries, backoff and leases. Pass/fail is decided by SLOs fixed in [`loadtest/src/slo.ts`](loadtest/src/slo.ts): zero lost submissions, submit p99 ≤ 500 ms, time to grade p95 ≤ 30 s and p99 ≤ 60 s. A run whose generator lags more than 250 ms p99 is reported as invalid, never as a pass.

## Results (public URL, 2026-11-04)

| Run | Load | Verdict | Result |
|---|---|---|---|
| [testing-day](loadtest/reports/lt-testing-day-202611040520/report.md) | Rate-equivalent to **40 classes / 1,200 students** (10 classes compressed 4×), × 10 problems; peak **6.9 submits/s** | **SHIP** | 3,000/3,000 graded, 0 lost. Submit p99 95 ms. Time to grade p95 4.9 s, p99 7.2 s. Queue never above 2. |
| [chaos, 30 s lease + 10 s heartbeat](loadtest/reports/lt-chaos-lease30-202611040610/report.md) | testing-day + the serving instance killed abruptly mid-run | **SHIP** | 0 lost; 2 submits (one 500, one 503) succeeded on retry. Time to grade max **38 s**, against 66 s with a [60 s lease](loadtest/reports/lt-chaos-lease60-202611040546/report.md). |
| [canary](loadtest/reports/lt-canary-202611040545/report.md) | 50 **real** grades in a 10 s burst (~5/s) | **SHIP** | Real model p50 2.8 s, p95 3.5 s. No 429s or 5xx. Cost $0.009. |

### Breakpoint: worker slots

Little's law: **jobs in flight = arrival rate × time per job**. A worker with *N* slots and ~3.4 s model calls grades at most *N* ÷ 3.4 per second.

| Run | Slots (`MODEL_CONCURRENCY`) | Arrival | Needed in flight (rate × 3.4 s) | Observed running | Max queue | Time to grade p95 | Verdict |
|---|---|---|---|---|---|---|---|
| [step 2×, 32 slots](loadtest/reports/lt-step-x2-202611040538/report.md) | 32 → ceiling 9.4/s | 14.0/s | 48 | **32 (capped)** | 347 | 39.8 s | **NO-SHIP** |
| [step 2×, 128 slots](loadtest/reports/lt-step-x2-202611041513/report.md) | 128 → ceiling 37.6/s | 14.0/s (~2,400 students) | 48 | 45 | 3 | 4.9 s | **SHIP** |
| [step 4×, 128 slots](loadtest/reports/lt-step-x4-202611041520/report.md) | 128 | 25.8/s (~4,800 students) | 88 | 90 (max 93) | 3 | 4.9 s | **SHIP** |

**Why 128:** 4× needs about 88 calls in flight at median latency, or 116 at p95 (25.8 × 4.5 s); 96 slots would leave no headroom for the slow tail. Slots spend their time waiting on the network, so they are cheap: at 4× the instance's CPU p99 was 40% and memory 31% of 512 MiB. `MODEL_MAX_IN_FLIGHT`, the fleet-wide cap enforced when a job is claimed, is also 128.

## Where it breaks next

1. **The 128 slots, at ~37.6 grades/s (~6,500 students).** Predicted by the same law that predicted the first break, not observed. Above it, the queue grows at (arrival − 37.6) per second.
2. **Cloud Run does not add instances to help.** It scales on HTTP traffic and cannot see the job queue. Every run stayed on **one instance**, because submits and polls stay cheap (p99 under 100 ms) while the backlog builds. With more instances, `MODEL_MAX_IN_FLIGHT` = 128 still caps the whole fleet by design, to protect the provider. **Scaling workers on queue depth is the first change needed at 10k students.**
3. **CPU on one vCPU:** 25% at 14/s and 40% at 25.8/s. On that trend it saturates somewhere past 60/s, beyond the slot ceiling.
4. **The provider:** unproven past ~5/s, as above.

Nothing else was close. Polls answered in p99 73 ms, there were no submit errors at 4×, and the simulator's injected 429s and 5xx (143 retries) were all absorbed.

## Limits of the evidence

- **The simulator tests this system, not the provider.** Only the model's network hop is simulated.
- **Simulator vs. reality:** the canary's real latency (p50 2.8 s, p95 3.5 s) is about 20% *faster* than the simulator's (3.4 s, 4.5 s), so the capacity numbers are conservative on latency. They are not conservative on rate limits, which the canary cannot show at 5/s.
- **The load generator** is one laptop over the public internet, so client latencies include that network hop. A run compressed N× drives 1/N of the classes N× faster, which keeps the arrival rate equal to the real-world scenario but does not create the full count of student rows.
- **Shared with production:** runs use the production instance and Neon database, tagged by `run_id` and deleted afterwards. Each run projects its database transfer before starting. All runs above used about 0.65 GB of Neon's 5 GB monthly transfer allowance.

### A bug the load test caught

Measuring database transfer before the first large run showed every student poll carrying the student's submitted drawings, even though unit and e2e tests passed. One testing day would have used a large share of Neon's 5 GB monthly transfer cap. Drawings are now fetched once, measured at ~35 KB per submission.

## Scaling from 1k to 1M students

Peak arrival ≈ **0.0058 submits/s per student** (6.9/s for 1,200). Model call ≈ **3.4 s**, so calls in flight = arrival × 3.4. Cost ≈ $0.0003 per grade including fallbacks, × 10 problems per student.

| Students at once | Peak submits/s | Calls in flight | What has to change | Model cost per testing day |
|---|---|---|---|---|
| **1,000** | 6 | ~20 | Nothing. | ~$3 |
| **10,000** | 58 | ~200 | Worker as its own service, **scaled on queue depth** (2+ instances × 128 slots); `MODEL_MAX_IN_FLIGHT` ~250; confirm OpenRouter's limits at that concurrency; paid Neon. | ~$30 |
| **100,000** | 580 | ~2,000 | Provider capacity is the constraint: several providers and keys, negotiated limits. Images in object storage, not Postgres. A partitioned or managed queue. Polling (~3,000 req/s) moves to push (SSE) or cached status. | ~$300 |
| **1,000,000** | 5,800 | ~20,000 | Dedicated model throughput or a self-hosted grader for common cases; Postgres sharded per district; event-driven status; multi-region. Caching identical answer-only submissions cuts calls. | ~$3,000 |

## Next steps

- A worker split from the API and autoscaled on queue depth.
- A sustained real-provider test at 30+ calls/s, with OpenRouter's limits confirmed in writing.
- A separate load-test environment: its own Neon project and a deployed fake model, so runs never share production.
- An automatic breakpoint search instead of fixed steps, and a scheduled GitHub Actions run.
- A fuller chaos suite: database failover, a full provider outage on the fallback path, network partitions.
- Secret Manager, least-privilege IAM and budget alerts for production.
