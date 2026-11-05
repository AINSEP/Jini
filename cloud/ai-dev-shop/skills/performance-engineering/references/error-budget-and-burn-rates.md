# Error Budgets and Burn Rates

Use this when performance targets are tied to a service-level objective rather than an isolated benchmark.

## Error Budget Mindset

Performance misses spend reliability budget.

Tie benchmark results back to:
- allowed failure rate
- acceptable latency miss rate
- time window

## Burn-Rate Interpretation

- Fast burn means active incident or bad rollout.
- Slow burn means chronic underperformance.

A change that barely misses the benchmark may still be unacceptable if it accelerates budget burn.

## Practical Use

When evaluating a performance change, report:
- benchmark result
- SLO target
- likely budget impact
- whether rollout should stop, slow, or continue behind a canary
