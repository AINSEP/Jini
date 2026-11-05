# Enterprise Spec Reference: Shift-Left Harnesses

Harnesses inject specialist constraints before implementation begins.

## Trigger Questions

After ADR approval and before task generation, the Coordinator checks:

1. Does the feature touch security-sensitive paths?
2. Does it require new or changed infrastructure?
3. Does it include explicit performance targets?

If yes, inject the matching harness into `tasks.md`.

## Security Harness

```text
## Constraints — Security

TASK-03 MUST use parameterized queries.
TASK-05 MUST implement rate limiting at the gateway.
TASK-07 requires auth middleware on the route.
TASK-09 must mask PII in logs.
```

Security writes constraints, not implementation code.

## Infrastructure Harness

```text
## Constraints — Infrastructure

New resources required:
  - PostgreSQL table: payments.invoice_line_items
  - SQS queue: payment-events-dlq
  - IAM role: payments-service-role

Deployment requirements:
  - production-standard deployment tier
  - dev -> staging -> production promotion order
  - GET /healthz must pass before traffic shift
```

Programmer does not provision infrastructure in this phase.

## Performance Harness

```text
## Constraints — Performance

REQ-01: POST /invoices p99 <= 500ms under 100 concurrent requests
REQ-06: GET /invoices/:id p99 <= 100ms under 500 concurrent requests
```

Performance targets must be testable. If they cannot be validated, the spec must be renegotiated before implementation.
