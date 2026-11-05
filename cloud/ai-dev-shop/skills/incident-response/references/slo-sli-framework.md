# SLO / SLI Framework

Use this when the incident response work needs reliability policy, paging thresholds, or post-incident budget discussion.

## Start With User-Facing SLIs

Prefer service indicators tied to actual user experience:
- availability: proportion of valid requests that succeed
- latency: proportion of requests under the required threshold
- correctness: proportion of requests that return the right result
- freshness: data age for pipelines and dashboards

## SLO Rules

- Set one clear window such as 30 days.
- State the exact target, for example `99.95% availability`.
- Convert the target into an error budget in minutes or events.
- Tie paging to budget burn, not raw CPU or memory alone.

## Burn-Rate Alerting

Typical pattern:
- fast alert: 5m / 1h windows for severe active burn
- slow alert: 30m / 6h windows for sustained degradation

The purpose:
- fast alerts catch acute incidents
- slow alerts catch chronic reliability drift

## Severity Guidance

- `SEV1`: broad outage, data loss risk, security event, or core business flow unusable
- `SEV2`: significant degradation or major feature outage with meaningful customer impact
- `SEV3`: limited impact, workaround exists, or small cohort affected
- `SEV4`: low urgency issue or operational improvement item

Upgrade severity when:
- impact expands
- duration exceeds the expected threshold for the current severity
- data integrity becomes uncertain

## Error Budget Policy

- Budget available: feature delivery can continue
- Budget burning quickly: slow rollout, require canaries, review recent changes
- Budget exhausted: pause non-essential feature work and prioritize reliability items

## Minimum Reliability Artifacts

- SLI definitions
- SLO targets
- dashboards for each SLI
- burn-rate alerts
- runbook link for each page-worthy alert
