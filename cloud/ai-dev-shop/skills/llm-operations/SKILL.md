---
name: llm-operations
version: 1.1.0
last_updated: 2026-03-24
description: Use when operating LLM features in production, including model routing, fallback chains, prompt versioning, evals, shadow testing, and AI cost guardrails.
---

# Skill: LLM Operations

Use this for operating AI features in production after prompt or retrieval design exists. `rag-ai-integration` covers application design; this skill covers runtime control.

## Trigger

- Routing between multiple models or providers
- Defining timeout, retry, and fallback rules for AI calls
- Shadow-testing or evaluating a new model before promotion
- Versioning prompts, rubrics, and model configs
- Enforcing token, cost, and rate-limit guardrails
- Designing LLM-specific regression checks and release gates

## Rules

- No unbounded retries and no unbounded generation.
- Every AI request has a timeout, retry cap, and fallback path.
- Model changes are evaluated against a fixed rubric before promotion.
- Prompt and model versions are logged with each production decision.
- Cost is a first-class production metric, not an afterthought.

## Workflow

1. Define the task contract and success rubric.
2. Set hard guardrails: timeout, retry cap, max tokens, max cost.
3. Choose routing strategy: fixed primary, weighted split, capability router, or shadow traffic.
4. Define fallback behavior for timeout, rate limit, malformed output, and budget exceedance.
5. Version prompts, models, and evaluator criteria.
6. Run evals before promotion and shadow-test when risk is non-trivial.
7. Emit runtime telemetry for cost, latency, failure mode, and fallback frequency.

## References

- Provider routing, circuit breakers, shadow traffic: `references/routing-and-fallbacks.md`
- Prompt versioning and eval loops: `references/evaluation-and-prompt-versioning.md`
- Cost controls and abuse guardrails: `references/ai-finops-and-guardrails.md`
- Cross-host peer-LLM packet, transport, and capability rules: `references/peer-llm-dispatch.md`
- Codex peer subprocess transport, version quarantine, and crash handling: `references/codex-dispatch.md`
