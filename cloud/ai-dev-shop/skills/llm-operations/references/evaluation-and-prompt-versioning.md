# Evaluation and Prompt Versioning

## Version Everything

Track at least:
- prompt template version
- model name and version
- tool schema version
- evaluator rubric version

Without this, regressions are hard to localize.

## Evaluation Loop

1. Freeze a representative dataset.
2. Define a scoring rubric before testing.
3. Measure correctness, structured output quality, latency, and cost.
4. Reject changes that improve one dimension by silently damaging another.

## Regression Gates

Use explicit promotion rules such as:
- no drop in critical correctness metrics
- malformed output below threshold
- latency within tolerated band
- cost within budget

## LLM-as-Judge

Useful for scalable comparisons, but only with:
- a stable rubric
- spot checks by humans
- direct checks for schema validity and hard business rules

Use judge models to rank or score, not to bypass deterministic validation.
