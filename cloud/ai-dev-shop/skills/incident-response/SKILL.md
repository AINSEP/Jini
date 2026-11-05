---
name: incident-response
version: 1.0.0
last_updated: 2026-03-13
description: Use when handling production incidents, defining severity and escalation, writing runbooks, or facilitating blameless post-mortems and SLO-driven follow-up.
---

# Skill: Incident Response

Use this for production outages, degraded services, rollback decisions, runbooks, and post-mortems.

## Trigger

- A production outage, degraded dependency, or data integrity concern is in progress
- You need a severity classification and escalation path
- A deployment or infrastructure change requires rollback/runbook planning
- A team needs a blameless post-mortem within 24-48 hours
- You are defining service-level objectives, alert burn rates, or on-call readiness

## Rules

- Classify severity before deep investigation. Severity drives cadence and escalation.
- Assign explicit roles: Incident Commander, Technical Lead, Communications Lead, Scribe.
- Timebox investigation branches. If a path is not confirming quickly, pivot.
- Prefer reversible actions first: rollback, disable, fail over, scale, rate limit.
- During active response, communicate on a fixed cadence even when status is unchanged.
- Post-mortems are blameless and system-focused. Do not write "who caused it."

## Workflow

1. Classify impact and severity.
2. Declare incident record, owners, and update cadence.
3. Confirm symptoms, blast radius, recent changes, and dependencies.
4. Work one hypothesis at a time and choose the fastest safe mitigation.
5. Verify recovery with service metrics, error rates, latency, and customer-visible checks.
6. Publish post-mortem and feed learnings back into runbooks, alerts, and SLOs.

## References

- Severity, SLOs, and error budgets: `references/slo-sli-framework.md`
- Post-mortem structure: `references/postmortem-template.md`
- Stakeholder updates and cadence: `references/stakeholder-communication.md`
