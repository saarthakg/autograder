# Load test lt-testing-day-202611040520: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `testing-day`. Expected load: 40 classes (1,200 students) × 10 problems, class starts staggered over 15 minutes. Run at 4× speed with 10 classes: same submits/s.
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T05:20:35.066Z
- **Ran:** 10 classes × 30 students × 10 problems = 300 students, 3000 submits, at 4× speed. Peak arrival **6.9 submits/s** (60 s window): the rate of 40 real classes (1,200 students) working in real time.
- **Grading:** in-process simulator (D-28): calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 122 ms; database ready after 40 ms.
- **Instances seen:** 1 (autograder-00007-w54-98c4449c).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 95 ms | PASS |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.00% | PASS |
| Time to grade p95 | ≤ 30 s | 4.9 s | PASS |
| Time to grade p99 | ≤ 60 s | 7.2 s | PASS |
| Drain after last submit | ≤ 300 s | 4.2 s | PASS |
| Needs-review rate | ≤ 1% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 13 ms | VALID |


## Where it slows down

Queue depth peaked at **2** jobs; the oldest waiting job was **9.3 s** old at worst.

Accepted per 10 s: `▁▁▁▂▂▂▃▂▃▄▃▃▄▄▄▅▅▅▄▇▇▅▇▇▇▇▇▇▆█▇▇▅▇▇▆▆█▆▇▆▅▇▇▇▆▆▅█▇▅▇▆▄▆▇▄▆▄▅▄▄▄▃▃▄▃▃▃▃▁▃▂▂▁▃▂▂▁▂▂▁▁▂▁▁▁▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▁▁▁▁▂▂▃▂▂▄▃▃▄▄▄▅▅▆▄▆▇▆▇▇▇███▆██▇▆▇▆█▆██▆▇▆▇▆█▇▆▆▇█▆▇▇▄▆▇▅▆▆▄▅▄▅▃▄▃▄▃▄▃▂▂▃▂▂▂▃▂▁▁▂▁▁▁▂▁▁▁▁▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 11 | 9 | 4.7 | 0 |
| 30 | 38 | 33 | 4.2 | 0 |
| 60 | 51 | 51 | 6.4 | 1 |
| 90 | 71 | 67 | 6.9 | 2 |
| 120 | 89 | 87 | 6.1 | 1 |
| 150 | 114 | 121 | 5.1 | 1 |
| 180 | 148 | 128 | 4.6 | 1 |
| 210 | 151 | 159 | 4.8 | 2 |
| 240 | 186 | 186 | 5.7 | 1 |
| 270 | 171 | 167 | 6.8 | 2 |
| 300 | 159 | 164 | 5.1 | 1 |
| 330 | 165 | 167 | 5.4 | 2 |
| 360 | 172 | 173 | 4.9 | 1 |
| 390 | 145 | 148 | 4.8 | 1 |
| 420 | 175 | 167 | 4.9 | 1 |
| 450 | 139 | 144 | 4.5 | 1 |
| 480 | 169 | 166 | 5.2 | 2 |
| 510 | 138 | 144 | 5.6 | 1 |
| 540 | 137 | 137 | 6.8 | 1 |
| 570 | 123 | 121 | 4.9 | 1 |
| 600 | 94 | 102 | 5.2 | 1 |
| 630 | 79 | 69 | 5.3 | 0 |
| 660 | 70 | 82 | 6.8 | 2 |
| 690 | 53 | 48 | 4.6 | 0 |
| 720 | 29 | 35 | 4.7 | 1 |
| 750 | 46 | 43 | 5.1 | 1 |
| 780 | 24 | 24 | 4.1 | 0 |
| 810 | 20 | 20 | 4.1 | 0 |
| 840 | 12 | 16 | 7.2 | 1 |
| 870 | 11 | 11 | 3.6 | 0 |
| 900 | 7 | 8 | 4.2 | 0 |
| 960 | 2 | 2 | 4.1 | 0 |
| 990 | 1 | 1 | 4.2 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 1380 | 80 | 99 | 163 | 307 | none |
| join | 300 | 49 | 64 | 130 | 223 | none |
| home | 300 | 57 | 69 | 107 | 212 | none |
| submit | 3000 | 66 | 78 | 91 | 1133 | none |
| poll | 6099 | 53 | 64 | 77 | 296 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 3000 (graded 3000); flagged reasons: none.
- Time to grade (s): p50 3.5, p95 4.9, p99 7.2, max 14.4.
- Model calls by outcome: provider_error 34, invalid_output 13, rate_limited 68, ok 3000. Job retries 102, dead jobs 0.
- Model latency, successful calls (ms): p50 3403, p95 4490, p99 5021, max 5997 (simulator).
- Estimated database transfer: **103.7 MB**, 34.6 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 3000; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 3000 grades × $0.0003 ≈ **$0.90** (blended Luna + 2% sol fallback, D-30); this run spent $0 on models.
