/**
 * @file Admission control for pulling submissions from a remote receiver. Manual and automatic
 * pulls share one per-receiver lease so two pulls never import the same page concurrently;
 * automatic triggers (startup, sign-in) are also debounced so repeated sign-ins cannot hammer a
 * receiver. There are no timers: every pull is caused by a trigger.
 */

/** Automatic pulls are skipped when the last pull STARTED less than this long ago. */
export const FORM_PULL_RECENT_MS = 60_000;

export type FormPullRefusal = "already-running" | "recent";
export type FormPullClaim = { readonly claimed: true } | { readonly claimed: false; readonly reason: FormPullRefusal };

/** Host lease store, keyed by (workspaceId, receiverKey). */
export interface FormPullLeasePort {
  /**
   * Atomically: refuse `already-running` while an unexpired lease is held (by any trigger); refuse
   * `recent` when the last start is younger than `recentMs`; otherwise record `nowIso` as the last
   * start and hold the lease until `nowIso + leaseMs`. An expired lease counts as free, which is how
   * a crash mid-pull recovers. A failed pull still counts as a start.
   */
  claim(
    required: { workspaceId: string; receiverKey: string; token: string; nowIso: string; recentMs: number; leaseMs: number },
    optional?: Record<string, never>,
  ): Promise<FormPullClaim>;
  /** Clears the lease only if `token` still holds it, so a late finisher cannot free a newer holder. */
  release(required: { workspaceId: string; receiverKey: string; token: string }, optional?: Record<string, never>): Promise<void>;
}

/**
 * Runs `pull` while holding the receiver lease. Manual pulls bypass only the recent-start check,
 * never the in-flight lease. `leaseMs` must outlast the host's bounded pull (prove it next to the
 * pull's page and time bounds), or a slow pull could overlap a second one.
 * @throws whatever `pull` throws, after releasing the lease.
 * @example await withFormPullLease({ leases, workspaceId, receiverKey, token, nowIso, leaseMs, trigger: 'automatic', pull });
 */
export async function withFormPullLease<T>(
  required: {
    leases: FormPullLeasePort; workspaceId: string; receiverKey: string; token: string; nowIso: string; leaseMs: number;
    trigger: "manual" | "automatic"; pull: () => Promise<T>;
  },
  _optional: Record<string, never> = {},
): Promise<{ ran: true; result: T } | { ran: false; reason: FormPullRefusal }> {
  const { leases, workspaceId, receiverKey, token, nowIso, leaseMs } = required;
  const recentMs = required.trigger === "automatic" ? FORM_PULL_RECENT_MS : 0;
  const claim = await leases.claim({ workspaceId, receiverKey, token, nowIso, recentMs, leaseMs });
  if (!claim.claimed) return { ran: false, reason: claim.reason };
  try {
    return { ran: true, result: await required.pull() };
  } finally {
    await leases.release({ workspaceId, receiverKey, token });
  }
}
