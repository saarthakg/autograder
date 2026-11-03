# Eval results

20 gold cases × k=3 runs per model, grade.v2 prompt. Projected $1.805; billed by OpenRouter $0.225; at list price $0.321. Cost / grade below is at list price from measured tokens.

Rates are pooled over runs; brackets are Wilson 95% CIs with n = distinct cases.

| Model | Role | Exact total | Within 1 | Criterion acc. | False full credit | False zero | Abstain on unreadable | Flip rate | Schema-valid | p50 / p95 latency | Cost / grade | Gates |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash | cheap | 94.8% [76.2%–99.1%] | 94.8% [76.2%–99.1%] | 100.0% [82.4%–100.0%] | 0.0% [0.0%–29.9%] | 0.0% [0.0%–18.4%] | 50.0% [9.5%–90.5%] | 0.0% [0.0%–16.1%] | 100.0% [83.9%–100.0%] | 1.4 s / 4.8 s | $0.00022 | 6/7 (some within CI) |
| openai/gpt-6-luna | cheap | 95.0% [76.4%–99.1%] | 95.0% [76.4%–99.1%] | 100.0% [82.4%–100.0%] | 0.0% [0.0%–29.9%] | 0.0% [0.0%–18.4%] | 50.0% [9.5%–90.5%] | 0.0% [0.0%–16.1%] | 100.0% [83.9%–100.0%] | 3.4 s / 4.5 s | $0.00023 | 7/7 (some within CI) |
| google/gemini-3.1-flash-lite | cheap | 95.0% [76.4%–99.1%] | 95.0% [76.4%–99.1%] | 100.0% [82.4%–100.0%] | 0.0% [0.0%–29.9%] | 0.0% [0.0%–18.4%] | 50.0% [9.5%–90.5%] | 0.0% [0.0%–16.1%] | 100.0% [83.9%–100.0%] | 1.8 s / 2.3 s | $0.00092 | 7/7 (some within CI) |
| qwen/qwen3-vl-30b-a3b-instruct | cheap | 78.3% [56.6%–90.9%] | 86.7% [65.9%–95.6%] | 87.7% [65.7%–96.3%] | 0.0% [0.0%–29.9%] | 2.0% [0.1%–21.5%] | 50.0% [9.5%–90.5%] | 25.0% [11.2%–46.9%] | 91.7% [72.0%–97.9%] | 5.8 s / 9.9 s | $0.00036 | 3/7 (some within CI) |
| openai/gpt-6.1-sol | reference | 95.0% [76.4%–99.1%] | 95.0% [76.4%–99.1%] | 100.0% [82.4%–100.0%] | 0.0% [0.0%–29.9%] | 0.0% [0.0%–18.4%] | 50.0% [9.5%–90.5%] | 0.0% [0.0%–16.1%] | 100.0% [83.9%–100.0%] | 3.0 s / 3.9 s | $0.00363 | 7/7 (some within CI) |

**Recommendation:** `openai/gpt-6-luna`. cheapest cheap model (at list price) that clears every gate.

- deepseek/deepseek-v4.1-flash: misses within one point; 2 provider error(s)
- openai/gpt-6-luna: clears every gate
- google/gemini-3.1-flash-lite: clears every gate
- qwen/qwen3-vl-30b-a3b-instruct: misses exact total, within one point, schema-valid, flip rate (k=3)
- openai/gpt-6.1-sol: clears every gate

## Wrong cases

Each miss with the model's transcription, to tell misreads (bad transcription) from misjudgments (good transcription, wrong verdict).

### deepseek/deepseek-v4.1-flash (5 of 60 samples)

- `p1-alternative` run 1: gold 111 (4 pts), got error. Read: "provider returned no content"
- `p1-arith-slip` run 2: gold 110 (2 pts), got error. Read: "provider returned no content"
- `p2-illegible` run 1: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 2: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 3: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"

### openai/gpt-6-luna (3 of 60 samples)

- `p2-illegible` run 1: gold abstain, got 000 (0 pts). Read: "✓ -2x + 3 > 11"
- `p2-illegible` run 2: gold abstain, got 000 (0 pts). Read: "−2x + 3 > 11"
- `p2-illegible` run 3: gold abstain, got 000 (0 pts). Read: "✓ -2x + 3 > 11"

### google/gemini-3.1-flash-lite (3 of 60 samples)

- `p2-illegible` run 1: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 2: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 3: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"

### qwen/qwen3-vl-30b-a3b-instruct (13 of 60 samples)

- `p1-answer-only` run 1: gold 001 (2 pts), got invalid. Read: "unknown criterion id "confidence""
- `p1-messy` run 1: gold 111 (4 pts), got 011 (3 pts). Read: "3x - 2 = 2x + 5 3x - 6 = 2x + 5 x - 6 = 5 x = 11"
- `p2-arith-slip` run 2: gold 010 (1 pts), got 000 (0 pts). Read: "-2x > 14 x < -7"
- `p2-answer-only` run 2: gold 001 (1 pts), got invalid. Read: "criterion "c1" judged twice"
- `p2-answer-only` run 3: gold 001 (1 pts), got invalid. Read: "criterion "c1" judged twice"
- `p2-messy` run 1: gold 111 (3 pts), got 101 (2 pts). Read: "-2x > 8 x > -4 x < -4"
- `p2-messy` run 2: gold 111 (3 pts), got 101 (2 pts). Read: "-2x > 8 x > -4 x < -4"
- `p2-messy` run 3: gold 111 (3 pts), got 101 (2 pts). Read: "-2x > 8 x > -4 x < -4"
- `p3-answer-only` run 1: gold 001 (1 pts), got invalid. Read: "unknown criterion id "confidence""
- `p3-answer-only` run 2: gold 001 (1 pts), got invalid. Read: "response does not match the schema: Expected a value with a length of at most 240 at ["criteria"][3]["evidence"]"
- `p2-illegible` run 1: gold abstain, got 000 (0 pts). Read: "-2x+3>11"
- `p2-illegible` run 2: gold abstain, got 000 (0 pts). Read: "-2x+3>11"
- `p2-illegible` run 3: gold abstain, got 000 (0 pts). Read: "-2x+3>11"

### openai/gpt-6.1-sol (3 of 60 samples)

- `p2-illegible` run 1: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 2: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
- `p2-illegible` run 3: gold abstain, got 000 (0 pts). Read: "-2x + 3 > 11"
