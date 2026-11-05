# Routing and Fallbacks

## Routing Modes

- Fixed primary with fallback: simplest default
- Weighted split: useful for controlled rollout
- Capability routing: choose provider by task type or context size
- Shadow traffic: evaluate alternative models without user-visible impact

Choose the least complex mode that solves the actual problem.

## Failure Classes

Handle these separately:
- timeout
- rate limit
- transient provider error
- malformed output
- failed schema validation
- budget exceeded

Do not treat all failures as "retry."

## Circuit Breaker Rules

Trip the provider when:
- failure velocity spikes
- rate limits persist
- malformed output rate exceeds threshold
- cost per successful call exceeds policy

When tripped:
- route to fallback
- log the reason
- alert humans if the incident is sustained or high-value

## Shadow Testing

For risky changes:
- send a bounded percentage or mirrored sample to the candidate model
- grade against a frozen rubric
- compare cost, latency, and correctness before promotion
