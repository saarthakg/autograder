# Load test lt-step-x4-202611041520: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `step`. Breakpoint step: testing-day's peak rate held for about 3.5 minutes (no stagger, 10× speed). Use --scale K for K× the load.
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T15:20:31.655Z
- **Ran:** 16 classes × 30 students × 10 problems = 480 students, 4800 submits, at 10× speed. Peak arrival **25.8 submits/s** (60 s window): the rate of 160 real classes (4,800 students) working in real time.
- **Grading:** in-process simulator: calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 154 ms; database ready after 48 ms.
- **Instances seen:** 1 (autograder-00011-4lm-379b5ea7).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 88 ms | PASS |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.00% | PASS |
| Time to grade p95 | ≤ 30 s | 4.9 s | PASS |
| Time to grade p99 | ≤ 60 s | 7.3 s | PASS |
| Drain after last submit | ≤ 300 s | 2.6 s | PASS |
| Needs-review rate | ≤ 1% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 2 ms | VALID |


## Where it slows down

Queue depth peaked at **3** jobs; the oldest waiting job was **14.5 s** old at worst.

Accepted per 10 s: `▂▇███▇██▇██▇█▇███▇▆▆▅▄▄▃▂▂▂▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▁▅██▇█▇█▇██████▇█▇▆▆▅▅▄▄▂▂▂▂▂▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 452 | 366 | 5.2 | 2 |
| 30 | 661 | 683 | 4.8 | 2 |
| 60 | 658 | 650 | 5.2 | 2 |
| 90 | 690 | 685 | 5.0 | 2 |
| 120 | 669 | 679 | 5.1 | 3 |
| 150 | 654 | 650 | 5.3 | 3 |
| 180 | 460 | 486 | 5.2 | 3 |
| 210 | 310 | 333 | 5.1 | 3 |
| 240 | 158 | 163 | 6.1 | 1 |
| 270 | 60 | 75 | 4.7 | 2 |
| 300 | 20 | 22 | 4.6 | 0 |
| 330 | 7 | 7 | 9.4 | 1 |
| 360 | 1 | 1 | 2.6 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 2016 | 83 | 106 | 175 | 303 | none |
| join | 480 | 51 | 78 | 121 | 142 | none |
| home | 480 | 56 | 84 | 109 | 161 | none |
| submit | 4800 | 64 | 76 | 87 | 361 | none |
| poll | 9637 | 53 | 63 | 73 | 260 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 4800 (graded 4800); flagged reasons: none.
- Time to grade (s): p50 3.4, p95 4.9, p99 7.3, max 20.7.
- Model calls by outcome: provider_error 42, rate_limited 101, invalid_output 23, ok 4800. Job retries 143, dead jobs 0.
- Model latency, successful calls (ms): p50 3388, p95 4467, p99 5067, max 6317 (simulator).
- Estimated database transfer: **167.1 MB**, 34.8 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 4800; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 4800 grades × $0.0003 ≈ **$1.44** (blended Luna + 2% sol fallback); this run spent $0 on models.
