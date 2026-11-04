# Eval results

3 gold cases × k=3 runs per model, grade.v2 prompt. Projected $0.080; billed by OpenRouter $0.026; at list price $0.040. Cost / grade below is at list price from measured tokens.

Rates are pooled over runs; brackets are Wilson 95% CIs with n = distinct cases.

| Model | Role | Exact total | Within 1 | Criterion acc. | False full credit | False zero | Abstain on unreadable | Flip rate | Schema-valid | p50 / p95 latency | Cost / grade | Gates |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openai/gpt-6-luna | cheap | 100.0% [43.8%–100.0%] | 100.0% [43.8%–100.0%] | 100.0% [34.2%–100.0%] | 0.0% [0.0%–79.3%] | 0.0% [0.0%–65.8%] | 100.0% [20.7%–100.0%] | 0.0% [0.0%–56.2%] | 100.0% [43.8%–100.0%] | 3.8 s / 4.9 s | $0.00022 | 7/7 (some within CI) |
| google/gemini-3.1-flash-lite | cheap | 66.7% [20.8%–93.9%] | 66.7% [20.8%–93.9%] | 100.0% [34.2%–100.0%] | 0.0% [0.0%–79.3%] | 0.0% [0.0%–65.8%] | 0.0% [0.0%–79.3%] | 0.0% [0.0%–56.2%] | 100.0% [43.8%–100.0%] | 2.0 s / 2.4 s | $0.00094 | 5/7 (some within CI) |
| openai/gpt-6.1-sol | reference | 100.0% [43.8%–100.0%] | 100.0% [43.8%–100.0%] | 100.0% [34.2%–100.0%] | 0.0% [0.0%–79.3%] | 0.0% [0.0%–65.8%] | 100.0% [20.7%–100.0%] | 0.0% [0.0%–56.2%] | 100.0% [43.8%–100.0%] | 3.0 s / 4.0 s | $0.00323 | 7/7 (some within CI) |

**Recommendation:** `openai/gpt-6-luna`. cheapest cheap model (at list price) that clears every gate.

- openai/gpt-6-luna: clears every gate
- google/gemini-3.1-flash-lite: misses exact total, within one point
- openai/gpt-6.1-sol: clears every gate

## Wrong cases

Each miss with the model's transcription, to tell misreads (bad transcription) from misjudgments (good transcription, wrong verdict).

### openai/gpt-6-luna (0 of 9 samples)


### google/gemini-3.1-flash-lite (3 of 9 samples)

- `p1-illegible` run 1: gold abstain, got 101 (3 pts). Read: "3x - 6 11"
- `p1-illegible` run 2: gold abstain, got 101 (3 pts). Read: "3x - 6 11"
- `p1-illegible` run 3: gold abstain, got 101 (3 pts). Read: "3x - 6 11"

### openai/gpt-6.1-sol (0 of 9 samples)

