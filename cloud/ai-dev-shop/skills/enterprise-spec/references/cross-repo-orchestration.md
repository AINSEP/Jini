# Enterprise Spec Reference: Cross-Repo Orchestration

## Program-Level Feature Specs

When a feature spans repositories or services, the top-level `feature.spec.md` lives at the program level and owns the end-to-end capability.

Program-level location:

```text
<AI_DEV_SHOP_ROOT>/specs/programs/<program-id>/<feature-spec-id>/feature.spec.md
```

## Repository Sub-Specs

After program-level approval, the Software Architect decomposes the feature into repository-specific sub-specs.

Sub-spec path pattern:

```text
<AI_DEV_SHOP_ROOT>/specs/programs/<program-id>/<feature-spec-id>/<repo-name>/feature.spec.md
```

Example:

```text
specs/programs/PROG-004/SPEC-042/payments-service/feature.spec.md
specs/programs/PROG-004/SPEC-042/notifications-service/feature.spec.md
specs/programs/PROG-004/SPEC-042/api-gateway/feature.spec.md
```

Rules:

- sub-specs use the strict-mode package format from `spec-writing`
- each sub-spec owns only its repository boundary
- shared behavior is referenced, not redefined

## Traceability Across Repositories

Program-level traceability must map requirements across repo boundaries.

```text
REQ-ID | Repo | Sub-Spec File | Implementation Reference | Test Reference | Status
REQ-01 | payments-service | SPEC-042/payments-service/feature.spec.md | src/payments/InvoiceService.ts | tests/invoice.test.ts | Verified
REQ-02 | notifications-service | SPEC-042/notifications-service/feature.spec.md | src/notify/EmailDispatcher.ts | tests/notify.test.ts | Verified
```

## Shared Integration Contracts

Shared contracts belong at the program level:

```text
<AI_DEV_SHOP_ROOT>/specs/programs/<program-id>/<feature-spec-id>/integration-contracts.ts
```

Example:

```typescript
export interface PaymentInitiatedEvent {
  eventId: string;
  invoiceId: string;
  amountInCents: number;
  currency: string;
  initiatedAt: string;
  customerId: string;
}

export interface NotificationRequest {
  recipientId: string;
  templateId: 'PAYMENT_CONFIRMED' | 'PAYMENT_FAILED';
  payload: Record<string, string>;
  idempotencyKey: string;
}
```

Sub-specs import shared contracts. They do not redefine them.

## Coordinator Tracking View

```text
PROG-004 / SPEC-042
  payments-service       -> Implementation: In Progress
  notifications-service  -> TDD: Complete
  api-gateway            -> Spec: Approved
  program-level          -> Integration contracts: Approved
```
