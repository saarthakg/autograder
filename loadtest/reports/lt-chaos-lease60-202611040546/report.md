# Load test lt-chaos-lease60-202611040546: SHIP

**SHIP**: every gated SLO passed.

- **Scenario:** `chaos`. testing-day with the serving instance killed abruptly 40% of the way through (the one chaos check).
- **Target:** https://autograder-768677959450.us-east4.run.app · started 2026-11-04T05:46:46.047Z
- **Ran:** 10 classes × 30 students × 10 problems = 300 students, 3000 submits, at 4× speed. Peak arrival **6.9 submits/s** (60 s window): the rate of 40 real classes (1,200 students) working in real time.
- **Grading:** in-process simulator: calibrated latency, injected 429/5xx/invalid output.
- **Cold start (excluded from SLOs):** first request 112 ms; database ready after 49 ms.
- **Instances seen:** 2 (autograder-00008-gtb-ee2feedf, autograder-00008-gtb-b1701200).
- **Chaos:** crashed instance `autograder-00008-gtb-ee2feedf` at 408 s (HTTP 200).

## SLOs

| SLO | Target | Actual | Result |
|---|---|---|---|
| Lost submissions (DB-checked) | = 0 | 0 | PASS |
| Submits never accepted (after client retries) | = 0 | 0 | PASS |
| Submit latency p99 (from scheduled send) | ≤ 500 ms | 133 ms | REPORT |
| Submit error rate (first attempt, 5xx/timeout) | ≤ 0.1% | 0.03% | REPORT |
| Time to grade p95 | ≤ 30 s | 4.9 s | REPORT |
| Time to grade p99 | ≤ 60 s | 9.0 s | REPORT |
| Drain after last submit | ≤ 300 s | 4.1 s | PASS |
| Needs-review rate | ≤ 5% | 0.00% | PASS |
| Generator lag p99 (validity gate) | ≤ 250 ms | 7 ms | VALID |

Under chaos, latency, error rate and time to grade are reported, not gated: the instance is killed on purpose. What must hold is that nothing is lost, every submit is eventually accepted, and the backlog drains.

## Where it slows down

Queue depth peaked at **4** jobs; the oldest waiting job was **61.1 s** old at worst.

Accepted per 10 s: `▁▁▁▂▂▂▃▂▃▄▃▃▄▄▄▅▅▅▄▇▇▅▇▇▇▇▇▇▆█▇▇▅▇▇▆▆█▆▇▆▅▇▇▇▆▆▅█▇▅▇▆▄▆▇▄▆▄▅▄▄▄▃▃▄▃▃▃▃▁▃▂▂▁▃▂▂▁▂▂▁▁▂▁▁▁▁▁▁▁▁▁▁▁▁▁`
Graded per 10 s:   `▁▁▁▁▂▁▂▂▂▃▃▂▃▃▄▄▄▄▃▅▆▄▆▆▆▇▇▆▅▆▆▆▅▆▆▆▅▆▄▅▅▅▅▅█▆▅▅▆▆▅▆▆▃▄▆▅▄▅▄▄▃▄▂▃▃▃▂▃▂▂▂▂▂▁▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁`

| t (s) | accepted | graded | time-to-grade p95 (s) | max queue |
|---|---|---|---|---|
| 0 | 11 | 10 | 4.3 | 0 |
| 30 | 38 | 30 | 4.4 | 0 |
| 60 | 51 | 55 | 5.0 | 1 |
| 90 | 71 | 65 | 4.9 | 1 |
| 120 | 89 | 89 | 4.8 | 0 |
| 150 | 114 | 116 | 4.8 | 0 |
| 180 | 148 | 132 | 4.6 | 0 |
| 210 | 151 | 156 | 6.8 | 2 |
| 240 | 186 | 188 | 6.2 | 2 |
| 270 | 171 | 167 | 5.0 | 0 |
| 300 | 159 | 162 | 4.7 | 2 |
| 330 | 165 | 169 | 4.7 | 0 |
| 360 | 172 | 150 | 64.7 | 1 |
| 390 | 145 | 146 | 5.5 | 1 |
| 420 | 175 | 189 | 4.9 | 4 |
| 450 | 139 | 146 | 4.7 | 1 |
| 480 | 169 | 167 | 5.9 | 1 |
| 510 | 138 | 142 | 4.8 | 0 |
| 540 | 137 | 142 | 5.2 | 0 |
| 570 | 123 | 121 | 4.9 | 1 |
| 600 | 94 | 99 | 6.1 | 1 |
| 630 | 79 | 70 | 5.1 | 1 |
| 660 | 70 | 79 | 5.2 | 1 |
| 690 | 53 | 49 | 5.1 | 1 |
| 720 | 29 | 36 | 4.4 | 0 |
| 750 | 46 | 44 | 6.4 | 1 |
| 780 | 24 | 22 | 5.2 | 0 |
| 810 | 20 | 22 | 5.8 | 0 |
| 840 | 12 | 15 | 4.1 | 0 |
| 870 | 11 | 11 | 7.7 | 1 |
| 900 | 7 | 8 | 5.5 | 0 |
| 960 | 2 | 2 | 3.4 | 0 |
| 990 | 1 | 1 | 4.1 | 0 |

## Endpoints (client-side ms, includes the network from the generator)

| Endpoint | n | p50 | p95 | p99 | max | non-2xx |
|---|---|---|---|---|---|---|
| report | 1380 | 80 | 104 | 206 | 428 | none |
| join | 300 | 49 | 57 | 82 | 164 | none |
| home | 300 | 57 | 66 | 91 | 233 | none |
| submit | 3001 | 68 | 81 | 133 | 930 | 503×1 |
| poll | 6240 | 54 | 64 | 107 | 1006 | none |

Submit latency is also scored from each submit's scheduled send time (the SLO above), so generator lag counts against the server, never for it.

## Server-side detail (Postgres, by run_id)

- Submissions: 3000 (graded 3000); flagged reasons: none.
- Time to grade (s): p50 3.5, p95 4.9, p99 9.0, max 66.1.
- Model calls by outcome: provider_error 20, invalid_output 14, rate_limited 57, ok 3000. Job retries 102, dead jobs 0.
- Model latency, successful calls (ms): p50 3386, p95 4498, p99 4991, max 5863 (simulator).
- Estimated database transfer: **104.0 MB**, 34.7 KB per submission (response bodies read from Postgres, plus each grade job reading its image back).
- Acknowledged submits checked against the database: 3000; missing 0; not terminal after drain 0.
- Join failures: 0. Drain wait: 6 s.
- Projected real-model cost of this load: 3000 grades × $0.0003 ≈ **$0.90** (blended Luna + 2% sol fallback); this run spent $0 on models.
