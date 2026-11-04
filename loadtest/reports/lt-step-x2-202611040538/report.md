# Load test lt-step-x2-202611040538: NO-SHIP

**NO-SHIP**: at least one gated SLO failed (below).

- **Scenario:** `step`. Breakpoint step: testing-day's peak rate held for about 3.5 minutes (no stagger, 10× speed). Use --scale K for K× the load.
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T05:38:10.004Z
- **Ran:** 8 classes × 30 students × 10 problems = 240 students, 2400 submits, at 10× speed. Peak arrival **14.0 submits/s** (60 s window): the rate of 80 real classes (2,400 students) working in real time.
- **Grading:** in-process simulator (D-28): calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 107 ms; database ready after 46 ms.
- **Instances seen:** 1 (autograder-00007-w54-98c4449c).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 108 ms | PASS |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.00% | PASS |
| Time to grade p95 | ≤ 30 s | 39.8 s | FAIL |
| Time to grade p99 | ≤ 60 s | 64.8 s | FAIL |
| Drain after last submit | ≤ 300 s | 2.7 s | PASS |
| Needs-review rate | ≤ 1% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 7 ms | VALID |


## Where it slows down

Queue depth peaked at **347** jobs; the oldest waiting job was **75.5 s** old at worst.

Accepted per 10 s: `▃▇██████████████▇▇▅▆▆▄▄▄▂▂▂▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▂▇█████████████████████████▃▂▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 241 | 179 | 7.5 | 25 |
| 30 | 333 | 271 | 15.3 | 95 |
| 60 | 348 | 267 | 22.4 | 162 |
| 90 | 350 | 274 | 50.5 | 242 |
| 120 | 319 | 273 | 64.0 | 295 |
| 150 | 315 | 265 | 42.4 | 347 |
| 180 | 230 | 274 | 40.4 | 334 |
| 210 | 160 | 266 | 42.7 | 290 |
| 240 | 61 | 273 | 24.0 | 165 |
| 270 | 32 | 44 | 17.8 | 1 |
| 300 | 8 | 10 | 17.0 | 2 |
| 330 | 2 | 3 | 3.1 | 0 |
| 360 | 1 | 1 | 2.7 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 1006 | 85 | 114 | 159 | 371 | none |
| join | 240 | 47 | 55 | 61 | 261 | none |
| home | 240 | 53 | 63 | 68 | 71 | none |
| submit | 2400 | 65 | 80 | 98 | 224 | none |
| poll | 7207 | 53 | 66 | 80 | 281 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 2400 (graded 2400); flagged reasons: none.
- Time to grade (s): p50 25.3, p95 39.8, p99 64.8, max 83.0.
- Model calls by outcome: provider_error 28, invalid_output 7, rate_limited 46, ok 2400. Job retries 74, dead jobs 0.
- Model latency, successful calls (ms): p50 3415, p95 4529, p99 5020, max 5891 (simulator).
- Estimated database transfer: **89.4 MB**, 37.3 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 2400; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 2400 grades × $0.0003 ≈ **$0.72** (blended Luna + 2% sol fallback, D-30); this run spent $0 on models.
