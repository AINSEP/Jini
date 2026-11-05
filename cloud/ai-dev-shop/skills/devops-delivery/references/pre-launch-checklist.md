<!-- Source: Addy Osmani / agent-skills / shipping-and-launch -->

# Pre-Launch Checklist

## Code Quality

- [ ] All required CI checks pass on the release commit.
- [ ] Feature flags, rollout controls, or kill switches are in place where appropriate.
- [ ] Dead code, debug code, and temporary logging have been removed or explicitly justified.
- [ ] Error handling covers expected failure modes.
- [ ] Rollback path is understood and tested.

## Security

- [ ] Authentication and authorization paths are covered by tests.
- [ ] Secrets are not committed, logged, exposed to clients, or stored in build artifacts.
- [ ] Dependency audit has been reviewed and high-risk findings resolved or accepted.
- [ ] User input is validated and encoded at trust boundaries.
- [ ] Sensitive data handling matches privacy and retention requirements.

## Performance

- [ ] Baseline latency, throughput, and resource usage are known.
- [ ] P95 and P99 latency are monitored for the launch path.
- [ ] Bundle size, asset weight, or payload size changes have been reviewed.
- [ ] Expensive queries or hot paths have been profiled.
- [ ] Caching behavior is intentional and invalidation is understood.

## Accessibility

- [ ] Keyboard navigation works for critical flows.
- [ ] Focus states and focus order are visible and logical.
- [ ] Form controls have labels and useful error messages.
- [ ] Color contrast meets the project standard.
- [ ] Screen reader names are correct for interactive controls.

## Infrastructure

- [ ] Dashboards exist for health, errors, latency, traffic, and saturation.
- [ ] Alerts route to the correct owners.
- [ ] Capacity is sufficient for expected traffic.
- [ ] Database migrations are backward-compatible or have a controlled rollout plan.
- [ ] External service dependencies and quotas have been checked.

## Documentation

- [ ] Release notes or changelog entries describe user-visible behavior changes.
- [ ] Runbooks cover launch verification and rollback.
- [ ] Known limitations and operational risks are documented.
- [ ] Support, QA, and stakeholders know what changed.
- [ ] Follow-up tasks are tracked with owners.

## Red Flag

"It's Friday afternoon, let's ship it" is a launch risk signal. If urgency is replacing verification, pause and reassess.
