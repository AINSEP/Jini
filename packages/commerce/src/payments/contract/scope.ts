/**
 * @file Who a money fact belongs to. Gap check 2026-10-21 item 1: every money row, credential slot,
 * webhook route and approval carries site/workspace + provider account + live/test mode, because a
 * key of `(provider, ref)` alone lets a test-mode webhook or another site's event touch a live
 * payment, and that cannot be added cheaply once rows exist.
 *
 * Ownership is established from verified endpoint/account configuration, never from a tenant id a
 * webhook payload supplies.
 */

export type PaymentMode = "test" | "live";

export interface PaymentScope {
  /** Tenant boundary (ADR-007: every method carries `workspaceId`). */
  readonly workspaceId: string;
  /** The site inside the workspace that sells. Single-site hosts pass their one site id. */
  readonly siteId: string;
  /** Registry id of the provider plugin (`stripe`, `paypal`, `lipay`). */
  readonly providerId: string;
  /** The merchant account at that provider (Stripe account id, PayPal merchant id). */
  readonly providerAccountId: string;
  readonly mode: PaymentMode;
}

/** The provider-side half of a scope: what a provider plugin is told about the account it acts for. */
export type ProviderAccountScope = Pick<PaymentScope, "providerAccountId" | "mode">;

const FIELDS = ["workspaceId", "siteId", "providerId", "providerAccountId"] as const;

/** Why a scope is unusable, or `null`. Empty ids are refused so no row is ever keyed by `""`. */
export function scopeProblem({ scope }: { scope: PaymentScope }, _optional: Record<string, never> = {}): string | null {
  for (const field of FIELDS) {
    if (scope[field].trim().length === 0) return `scope.${field} must be a non-empty string`;
  }
  if (scope.mode !== "test" && scope.mode !== "live") return `scope.mode must be "test" or "live"`;
  return null;
}

/** True when two scopes name the same workspace, site, provider account and mode. */
export function sameScope({ a, b }: { a: PaymentScope; b: PaymentScope }, _optional: Record<string, never> = {}): boolean {
  return FIELDS.every((field) => a[field] === b[field]) && a.mode === b.mode;
}
