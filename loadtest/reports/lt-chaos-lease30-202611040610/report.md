# Load test lt-chaos-lease30-202611040610: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `chaos`. testing-day with the serving instance killed abruptly 40% of the way through (the one chaos check).
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T06:10:02.929Z
- **Ran:** 10 classes × 30 students × 10 problems = 300 students, 3000 submits, at 4× speed. Peak arrival **6.9 submits/s** (60 s window): the rate of 40 real classes (1,200 students) working in real time.
- **Grading:** in-process simulator: calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 159 ms; database ready after 43 ms.
- **Instances seen:** 2 (autograder-00009-rjj-71d73bf6, autograder-00009-rjj-fe6b459c).
- **Chaos:** crashed instance `autograder-00009-rjj-71d73bf6` at 408 s (HTTP 200).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 198 ms | REPORT |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.07% | REPORT |
| Time to grade p95 | ≤ 30 s | 5.2 s | REPORT |
| Time to grade p99 | ≤ 60 s | 9.4 s | REPORT |
| Drain after last submit | ≤ 300 s | 3.1 s | PASS |
| Needs-review rate | ≤ 5% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 16 ms | VALID |

Under chaos, latency, error rate and time to grade are reported, not gated: the instance is killed on purpose. What must hold is that nothing is lost, every submit is eventually accepted, and the backlog drains.

## Where it slows down

Queue depth peaked at **3** jobs; the oldest waiting job was **30.3 s** old at worst.

Accepted per 10 s: `▁▁▁▂▂▂▃▂▃▄▃▃▄▄▄▅▅▅▄▇▇▅▇▇███▇▇█▇▇▆▇▇▆▆█▇▇▆▅▇▇▇▆▆▆██▅█▆▄▆▇▄▆▄▅▄▄▄▃▃▄▃▃▄▃▁▃▂▂▁▃▂▂▁▂▂▁▁▂▁▁▁▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▁▁▁▁▂▁▃▂▂▃▃▂▃▄▄▄▅▅▃▆▆▅▇▇▅██▇▆▇▇▇▅▇▆▇▆▇▅▆▆█▆▆▇▆▅▅▇▇▆▆▇▄▅▆▅▅▅▄▄▄▄▃▄▃▄▂▄▂▂▂▂▂▁▂▂▂▁▁▂▁▁▁▂▁▁▁▁▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 11 | 9 | 4.4 | 0 |
| 30 | 38 | 31 | 5.9 | 1 |
| 60 | 51 | 54 | 5.1 | 0 |
| 90 | 71 | 67 | 4.7 | 0 |
| 120 | 89 | 88 | 6.2 | 1 |
| 150 | 114 | 119 | 4.6 | 0 |
| 180 | 148 | 128 | 6.2 | 2 |
| 210 | 150 | 160 | 5.8 | 3 |
| 240 | 187 | 183 | 7.8 | 2 |
| 270 | 171 | 169 | 5.6 | 1 |
| 300 | 159 | 161 | 5.2 | 2 |
| 330 | 165 | 168 | 5.5 | 1 |
| 360 | 172 | 150 | 35.7 | 1 |
| 390 | 145 | 173 | 4.6 | 3 |
| 420 | 175 | 166 | 4.8 | 1 |
| 450 | 139 | 142 | 6.2 | 2 |
| 480 | 169 | 169 | 6.2 | 2 |
| 510 | 138 | 142 | 4.7 | 1 |
| 540 | 137 | 141 | 5.2 | 1 |
| 570 | 123 | 120 | 4.8 | 0 |
| 600 | 94 | 99 | 6.6 | 3 |
| 630 | 80 | 72 | 5.7 | 1 |
| 660 | 69 | 82 | 5.3 | 0 |
| 690 | 53 | 46 | 5.1 | 1 |
| 720 | 29 | 36 | 4.6 | 0 |
| 750 | 46 | 43 | 5.3 | 0 |
| 780 | 24 | 25 | 7.7 | 0 |
| 810 | 20 | 17 | 7.1 | 1 |
| 840 | 12 | 18 | 4.5 | 0 |
| 870 | 11 | 11 | 4.6 | 0 |
| 900 | 7 | 8 | 6.6 | 0 |
| 960 | 2 | 2 | 3.2 | 0 |
| 990 | 1 | 1 | 3.1 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 1380 | 82 | 100 | 292 | 602 | none |
| join | 300 | 49 | 57 | 62 | 67 | none |
| home | 300 | 58 | 66 | 69 | 101 | none |
| submit | 3002 | 72 | 83 | 200 | 2738 | 500×1, 503×1 |
| poll | 6211 | 56 | 67 | 220 | 2925 | 500×2 |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 3000 (graded 3000); flagged reasons: none.
- Time to grade (s): p50 3.5, p95 5.2, p99 9.4, max 38.4.
- Model calls by outcome: provider_error 30, rate_limited 67, invalid_output 6, ok 3000. Job retries 122, dead jobs 0.
- Model latency, successful calls (ms): p50 3373, p95 4510, p99 5049, max 6490 (simulator).
- Estimated database transfer: **103.9 MB**, 34.6 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 3000; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 3000 grades × $0.0003 ≈ **$0.90** (blended Luna + 2% sol fallback); this run spent $0 on models.
