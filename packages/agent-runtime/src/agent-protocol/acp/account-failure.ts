/** @module agent-protocol/acp/account-failure
 * Injection seam for classifying agent-provider account-failure text (auth
 * required, insufficient balance, quota exhausted, etc.) into a structured,
 * actionable error. OD's real implementation classifies vela/AMR-branded
 * failure text against a hardcoded, product-branded recharge URL — that
 * adapter is product-specific and must not live in this package (see
 * archived provenance ledger for the full account of what was left behind and why).
 * Callers inject their own `AccountFailureClassifier` through
 * `AttachAcpSessionOptions.accountFailureClassifier`; the default
 * `noopAccountFailureClassifier` always returns `null`, which reproduces the
 * behavior of not having this feature at all — no promotion ever fires.
 * Depends on nothing; consumed by acp/updates.ts and acp/session.ts.
 */

/**
 * A structured, provider-agnostic account failure classification. Shaped
 * generically (not AMR-specific field names) so any provider's classifier can
 * satisfy this contract.
 */
export interface AccountFailure {
  /** A stable machine-readable failure code (e.g. `'AUTH_REQUIRED'`). */
  code: string;
  /** A human-readable message describing the failure and how to recover. */
  message: string;
  /** The recovery action the caller should surface to the end user. */
  action: string;
  /** Optional URL to send the user to for taking `action` (e.g. a billing page). */
  actionUrl?: string;
}

/**
 * Injectable port: classifies free-form diagnostic text (drawn from an ACP
 * session update or a stderr tail) into a structured `AccountFailure`, or
 * `null` when the text does not match a known account-failure pattern.
 */
export interface AccountFailureClassifier {
  classify(requiredArgs: { text: string }): AccountFailure | null;
}

/**
 * Default no-op classifier used when a caller does not inject a real one.
 * Always returns `null`, meaning no account-failure promotion ever fires —
 * identical observable behavior to not having the feature at all.
 */
export const noopAccountFailureClassifier: AccountFailureClassifier = {
  classify(): AccountFailure | null {
    return null;
  },
};

/**
 * Builds the `details` payload attached to a promoted account-failure error.
 *
 * @param failure - The classification result to describe.
 * @returns A details object carrying `action` and, when present, `actionUrl`.
 */
export function accountFailureDetails(failure: AccountFailure): {
  kind: 'account_failure';
  action: string;
  actionUrl?: string;
} {
  return {
    kind: 'account_failure',
    action: failure.action,
    ...(failure.actionUrl ? { actionUrl: failure.actionUrl } : {}),
  };
}
