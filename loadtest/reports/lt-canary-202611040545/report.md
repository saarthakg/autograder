# Load test lt-canary-202611040545: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `canary`. Calibration: 50 REAL model calls through the deployed path as a burst at testing-day peak (about 5 submits/s for 10 s), behind the budget guard.
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T05:45:20.168Z
- **Ran:** 1 class × 50 students × 1 problems = 50 students, 50 submits, at 1× speed. Peak arrival **0.8 submits/s** (60 s window): the rate of 1 real class (50 students) working in real time.
- **Grading:** REAL model calls (canary).
- **Cold start (excluded from SLOs):** first request 186 ms; database ready after 86 ms.
- **Instances seen:** 1 (autograder-00007-w54-98c4449c).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 201 ms | PASS |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.00% | PASS |
| Time to grade p95 | ≤ 30 s | 3.5 s | PASS |
| Time to grade p99 | ≤ 60 s | 4.4 s | PASS |
| Drain after last submit | ≤ 300 s | 3.0 s | PASS |
| Needs-review rate | ≤ 1% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 12 ms | VALID |


## Where it slows down

Queue depth peaked at **0** jobs; the oldest waiting job was **0.0 s** old at worst.

Accepted per 10 s: `█▁`
Graded per 10 s:   `█▃`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 50 | 50 | 3.5 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 3 | 74 | 139 | 139 | 139 | none |
| join | 50 | 52 | 127 | 184 | 184 | none |
| home | 50 | 58 | 68 | 86 | 86 | none |
| submit | 50 | 71 | 142 | 200 | 200 | none |
| poll | 100 | 54 | 104 | 191 | 221 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 50 (graded 50); flagged reasons: none.
- Time to grade (s): p50 2.8, p95 3.5, p99 4.4, max 5.2.
- Model calls by outcome: ok 50. Job retries 0, dead jobs 0.
- Model latency, successful calls (ms): p50 2794, p95 3466, p99 4368, max 5147 (REAL provider).
- Estimated database transfer: **0.4 MB**, 7.5 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 50; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 50 grades × $0.0003 ≈ **$0.01** (blended Luna + 2% sol fallback); this run spent real money (canary).
