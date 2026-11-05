# AI FinOps and Guardrails

## Minimum Runtime Guardrails

Every AI call should define:
- request timeout
- retry limit
- token ceiling
- cost ceiling
- fallback behavior

## Budget Policy

Track:
- cost per request
- cost per workflow
- cost by model/provider
- fallback rate
- abandonment rate after AI failure

Set alerts for:
- sharp traffic spikes
- sustained 402 / 429 patterns
- sudden cost-per-success increase

## Abuse and Runaway Protection

Protect against:
- bots hitting expensive endpoints
- loops that re-invoke the same prompt chain
- prompt growth causing context explosion
- fallback storms that make outages more expensive

Useful controls:
- rate limits
- per-user / per-tenant budgets
- circuit breakers
- cache repeated prompts/results where safe
