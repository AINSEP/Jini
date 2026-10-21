/**
 * @file `createPaymentsService` (lot L4): the kernel's implementation of the consumer
 * `PaymentsPort`. Consumers (donations, checkout, bookings) get this object and nothing else: no
 * provider, credential or ledger row reaches them.
 *
 * Each operation lives in its own module (`intent.ts`, `refund.ts`, `capture-void.ts`); this file
 * only wires the injected dependencies and the read paths.
 */
import type { PaymentsPort, PaymentView } from "../contract/payments-port.js";
import { scopeProblem, type PaymentScope } from "../contract/scope.js";
import { capture, voidPayment } from "./capture-void.js";
import { readPayment } from "./common.js";
import { resolveOpsDeps, type OpsDeps, type PaymentsServiceOptional, type PaymentsServiceRequired } from "./deps.js";
import { createIntent } from "./intent.js";
import { resolveUnknown, type ResolveUnknownRequired, type ResolveUnknownResult } from "./operator.js";
import { createCursorReconciler, type ReconcileOptions, type ReconcileReport } from "./reconciler.js";
import { refund } from "./refund.js";
import { paymentView, providerSummary } from "./view.js";

async function getPayment({ deps, scope, paymentId }: { deps: OpsDeps; scope: PaymentScope; paymentId: string }): Promise<PaymentView | null> {
  if (scopeProblem({ scope })) return null;
  const record = await deps.ledger.transaction((tx) => readPayment({ tx, scope, paymentId }));
  return record ? paymentView(record) : null;
}

/**
 * Builds the payments service.
 * @param required - Ledger, provider registry, provider-context resolver, grant store, clock, ids.
 * @param optional.risk - The pre-charge risk gate; absent = every intent is allowed.
 * @param optional.alerts - Stuck-money alert sink; absent = alerts are dropped.
 * @example const payments = createPaymentsService({ ledger, providers, contexts, grants, now: Date.now, newId: randomUUID });
 */
export function createPaymentsService(required: PaymentsServiceRequired, optional: PaymentsServiceOptional = {}): PaymentsPort {
  const deps = resolveOpsDeps(required, optional);
  return {
    createIntent: (r, o) => createIntent({ deps, required: r }, o),
    refund: (r, o) => refund({ deps, required: r }, o),
    capture: (r) => capture({ deps, required: r }),
    void: (r) => voidPayment({ deps, required: r }),
    getPayment: ({ scope, paymentId }) => getPayment({ deps, scope, paymentId }),
    listProviders: () => deps.providers.list().map((registered) => providerSummary(registered)),
  };
}

/** The back-office half: never handed to consumer plugins. A host schedules the reconciler and exposes resolve to operators. */
export interface PaymentsOperatorPort {
  /** One reconcile pass; it resumes where this port's previous pass of the same scope stopped (see `reconciler.ts`). */
  reconcileUnknown(required: { olderThanMs: number; limit: number }, optional?: ReconcileOptions): Promise<ReconcileReport>;
  resolveUnknown(required: ResolveUnknownRequired, optional?: Record<string, never>): Promise<ResolveUnknownResult>;
}

/** Builds the reconciler + operator resolution over the same dependencies as {@link createPaymentsService}. */
export function createPaymentsOperator(required: PaymentsServiceRequired, optional: PaymentsServiceOptional = {}): PaymentsOperatorPort {
  const deps = resolveOpsDeps(required, optional);
  return {
    reconcileUnknown: createCursorReconciler({ deps }),
    resolveUnknown: (r) => resolveUnknown({ deps, required: r }),
  };
}
