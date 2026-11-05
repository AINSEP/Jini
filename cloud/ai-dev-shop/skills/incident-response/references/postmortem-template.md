# Post-Mortem Template

Use this after the incident is stabilized. Publish a draft within 24 hours and a reviewed version within 48 hours.

## Header

- Incident title
- Date
- Severity
- Start and end time
- Duration
- Authors
- Status: Draft / Review / Final

## Executive Summary

Two or three sentences:
- what failed
- who or what was affected
- how service was restored

## Impact

- Users affected
- Internal teams affected
- Revenue or operational impact
- SLO budget consumed
- Support volume or customer escalations

## Timeline

Record UTC timestamps for:
- detection
- declaration
- major hypotheses
- mitigations attempted
- successful fix
- customer/internal all-clear

## Root Cause Analysis

### What happened

Describe the technical failure chain plainly.

### Contributing factors

Break down:
- immediate trigger
- enabling condition
- systemic/process gap

### Five whys

Push until the answer becomes a missing control, unclear ownership, missing test, weak alert, or flawed change process.

## What Went Well

- Good alerts
- Fast rollback
- Clear ownership
- Useful runbooks

## What Went Poorly

- Late detection
- Misleading telemetry
- Missing dashboards
- Slow approvals
- Confusing ownership

## Action Items

For each item include:
- ID
- action
- owner
- priority
- due date
- status

Action items should close the systemic gap, not merely restate the bug fix.

## Lessons Learned

Capture the few points that should change future architecture, testing, deployment, or operations behavior.
