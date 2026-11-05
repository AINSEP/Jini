<!-- Source: Addy Osmani / agent-skills / shipping-and-launch -->

# Rollout Decision Thresholds

Use objective rollout thresholds before expanding traffic. Compare launch metrics against the established baseline for the same service, route, user segment, and time window.

| Tier | Decision | Criteria |
|---|---|---|
| Advance | Green: continue rollout | Error rate within ±5% of baseline, P95 latency within ±10% of baseline, no material client-side error increase, business metrics stable |
| Hold and investigate | Yellow: pause rollout expansion | Error rate is 5–100% above baseline OR P95 latency is 10–50% above baseline, suspicious logs or alerts appear, dashboards show unclear degradation, support signals increase |
| Roll back | Red: revert or disable rollout | Error rate is more than 2× baseline, P95 latency is more than 50% above baseline, client JavaScript errors exceed 0.1% of sessions, business metrics decline more than 5% |

## First-Hour Post-Launch Verification

Run this sequence immediately after launch and before increasing rollout percentage:

1. Confirm the health endpoint returns `200`.
2. Check error monitoring for new exceptions or alert spikes.
3. Review latency dashboards, especially P95 and P99.
4. Manually complete the critical user flow.
5. Confirm logs are flowing with expected volume and fields.

Do not advance rollout while any verification step is failing or unknown.
