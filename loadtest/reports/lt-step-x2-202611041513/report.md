# Load test lt-step-x2-202611041513: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `step`. Breakpoint step: testing-day's peak rate held for about 3.5 minutes (no stagger, 10× speed). Use --scale K for K× the load.
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T15:13:52.796Z
- **Ran:** 8 classes × 30 students × 10 problems = 240 students, 2400 submits, at 10× speed. Peak arrival **14.0 submits/s** (60 s window): the rate of 80 real classes (2,400 students) working in real time.
- **Grading:** in-process simulator (D-28): calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 168 ms; database ready after 45 ms.
- **Instances seen:** 1 (autograder-00011-4lm-379b5ea7).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 86 ms | PASS |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.00% | PASS |
| Time to grade p95 | ≤ 30 s | 4.9 s | PASS |
| Time to grade p99 | ≤ 60 s | 7.4 s | PASS |
| Drain after last submit | ≤ 300 s | 2.7 s | PASS |
| Needs-review rate | ≤ 1% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 7 ms | VALID |


## Where it slows down

Queue depth peaked at **3** jobs; the oldest waiting job was **6.1 s** old at worst.

Accepted per 10 s: `▃▇██████████████▇▇▅▆▆▄▄▄▂▂▂▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▁▆█▇█▇▇█▇█▇█▇▇▇█▇▇▅▆▅▅▄▃▂▂▂▂▁▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 241 | 207 | 5.1 | 1 |
| 30 | 333 | 330 | 5.0 | 3 |
| 60 | 348 | 339 | 7.0 | 2 |
| 90 | 350 | 353 | 4.4 | 1 |
| 120 | 319 | 323 | 5.9 | 3 |
| 150 | 314 | 322 | 5.2 | 2 |
| 180 | 231 | 234 | 5.6 | 1 |
| 210 | 160 | 171 | 7.3 | 2 |
| 240 | 61 | 72 | 4.8 | 0 |
| 270 | 32 | 35 | 7.1 | 0 |
| 300 | 8 | 10 | 3.9 | 0 |
| 330 | 2 | 3 | 3.6 | 0 |
| 360 | 1 | 1 | 2.7 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 1008 | 80 | 101 | 147 | 239 | none |
| join | 240 | 49 | 56 | 128 | 203 | none |
| home | 240 | 56 | 64 | 118 | 220 | none |
| submit | 2400 | 65 | 75 | 84 | 692 | none |
| poll | 4825 | 52 | 62 | 73 | 262 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 2400 (graded 2400); flagged reasons: none.
- Time to grade (s): p50 3.5, p95 4.9, p99 7.4, max 11.4.
- Model calls by outcome: provider_error 23, invalid_output 21, rate_limited 46, ok 2400. Job retries 69, dead jobs 0.
- Model latency, successful calls (ms): p50 3397, p95 4506, p99 4922, max 6364 (simulator).
- Estimated database transfer: **83.5 MB**, 34.8 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 2400; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 2400 grades × $0.0003 ≈ **$0.72** (blended Luna + 2% sol fallback, D-30); this run spent $0 on models.
