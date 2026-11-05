# Canary

## When

Use after deployment or before broad rollout to monitor a small set of critical production or staging paths.

## Workflow

1. Confirm target environment, URLs, health endpoints, and observation duration.
2. Establish baseline signals: HTTP status, console/network behavior when browser automation is available, deploy status, logs, or metrics.
3. Run a short monitoring loop over critical paths.
4. Classify anomalies by severity and likely user impact.
5. Recommend continue, investigate, pause rollout, or rollback request.

## Output

- Target and duration
- Checks run
- Evidence table
- Canary verdict: stable, unstable, blocked, or inconclusive
- Recommended next action

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that trigger rollback, alter traffic, change feature flags, or trigger external deployments. Do not proceed until the user says "yes" or "approved".
- Do not claim production health from a single successful request if required paths were not checked.
- Do not expose secrets or private URLs in shared reports.
