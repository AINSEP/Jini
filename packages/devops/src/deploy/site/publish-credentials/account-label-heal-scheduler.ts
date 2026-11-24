import type { PublishCredentialSummary, PublishProviderId } from "./types.js";

/**
 * @file A tiny fire-and-forget scheduler for "heal this row's account label in the background,
 * without ever blocking or breaking the caller's own read." Built for exactly one kind of caller — the
 * host's human-gated publish-credentials list handler — but kept free of any domain knowledge (no
 * provider vocabulary, no verify/decrypt concept) so it never has to import the host's provider-verify
 * module. That module already imports FROM this feature (`types.ts` is the lower, canonical module;
 * the static-publish side borrows its provider union, not the other way round), so a reverse import
 * here would open a module cycle. The caller decides WHICH ids need healing
 * ({@link idsNeedingAccountLabelHeal}, using a `canYieldAccountLabel` predicate it supplies), WHAT
 * healing an id means (its own `heal` callback, `verifyAfterSave`-shaped) and HOW a failure is
 * reported (its own `onHealError`); this module only decides WHEN to call `heal`, and never more than
 * once per id at a time.
 *
 * Why this exists — the mechanism it fixes:
 * a stored credential's account label starts `null` on every row and is only ever populated by a
 * human-gated verify-then-heal pass. That pass already runs automatically on every save — so a NEWLY
 * saved credential heals itself immediately — but a row whose very first auto-verify failed (provider
 * unreachable at save time, or a row saved before that wiring existed) stays `null` forever unless a
 * human clicks a per-row "Verify" action. This scheduler closes that gap: the host's list read calls
 * {@link AccountLabelHealScheduler.triggerFor} with every currently-null, healable row id on every
 * list request, and this module guarantees at most one heal attempt per id is ever in flight, and that
 * a failed or slow attempt can never surface as an error on the READ that triggered it.
 *
 * Deliberately NOT reachable from anywhere agent-facing: only a human-gated host surface (a provider
 * probe is never an agent tool) is expected to hold a reference to a scheduler instance. This module
 * cannot enforce that itself — it has no way to — so the boundary is a wiring discipline the CALLER
 * owns, exactly like the host's own `verifyAfterSave` already is for the identical reason.
 *
 * Architecture ADR: `ADS-memory/reports/jini-port/extraction-plan.md`.
 */

/**
 * Every id in `credentials` whose `accountLabel` is still unknown AND whose provider can ever produce
 * one — probing a provider `canYieldAccountLabel` already says "no" for would be a wasted network call
 * on a read path for a result that can never arrive, so those rows are excluded here rather than left
 * for the scheduler to attempt and silently no-op.
 * @complexity O(n) in `credentials.length` — one filter pass, no per-row I/O.
 */
export function idsNeedingAccountLabelHeal({ credentials, canYieldAccountLabel }: { credentials: readonly PublishCredentialSummary[]; canYieldAccountLabel: (providerId: PublishProviderId) => boolean }, _options = {}): string[] {
  return credentials.filter((c) => c.accountLabel === null && canYieldAccountLabel(c.providerId)).map((c) => c.id);
}

export interface AccountLabelHealSchedulerDeps {
  /** Attempts to heal exactly one row — expected to be `verifyAfterSave`-shaped (probe the real
   *  provider, then persist the label if one came back). May reject; a rejection is caught and
   *  reported via `onHealError`, never re-thrown into whatever triggered this heal. */
  heal(required: { id: string }, optional?: Record<string, never>): Promise<unknown>;
  /** Called when `heal` rejects (or throws synchronously, despite the documented contract — see
   *  {@link createAccountLabelHealScheduler}'s own doc), and once more under id `"*"` if reporting
   *  itself throws. Required: this package never logs, so the host binds its own reporter (typically
   *  the same fallback logging its route errors already use, so a background heal failure shows up in
   *  the same place an unexpected route error does). */
  onHealError(required: { id: string; err: unknown }, options?: object): void;
}

export interface AccountLabelHealScheduler {
  /**
   * Fires `deps.heal({ id })` for every id in `ids` not ALREADY in flight from a previous call — never
   * awaited, never throws, never returns a rejected (or any) Promise to the caller. Safe to call on
   * every single request: an id already healing is simply skipped; an id whose previous attempt already
   * settled (success OR failure) is eligible again, so a transient failure is not a permanent
   * blacklist.
   * @complexity O(n) in `ids.length` — one Set membership check and, for a new id, one fire-and-forget
   *   call per entry.
   */
  triggerFor(ids: readonly string[]): void;
}

/** Starts exactly one heal attempt for `id` — the one place this module calls `deps.heal`. Wrapped in
 *  its own `try`/`catch` around the CALL itself, not just a `.catch()` on its return value: `heal` is
 *  documented to always return a Promise (never throw synchronously), but this module must not depend
 *  on every caller honoring that — a synchronous throw here, left unguarded, would escape `triggerFor`
 *  and, at the expected call site (a route handler that already sent its response), turn into exactly
 *  the unhandled-async-rejection bug class that can take down a whole server process. */
function startHeal({ id, deps, inFlight }: { id: string; deps: AccountLabelHealSchedulerDeps; inFlight: Set<string> }, _options = {}): void {
  inFlight.add(id);
  let result: Promise<unknown>;
  try {
    result = deps.heal({ id });
  } catch (err) {
    inFlight.delete(id);
    deps.onHealError({ id, err });
    return;
  }
  result
    .catch((err: unknown) => deps.onHealError({ id, err }))
    .finally(() => {
      inFlight.delete(id);
    });
}

/**
 * Builds one scheduler instance. Call ONCE per route registration (like `verifyAfterSave` itself) and
 * reuse it across every request — the in-flight tracking is only useful if it survives between calls.
 * @complexity O(1) to construct.
 */
export function createAccountLabelHealScheduler(deps: AccountLabelHealSchedulerDeps): AccountLabelHealScheduler {
  const inFlight = new Set<string>();

  return {
    triggerFor(ids: readonly string[]): void {
      // Defense in depth, matching `startHeal`'s own reasoning: the expected caller is a route handler
      // that has already sent its response by the time this runs, so NOTHING here may ever throw back
      // into it — not even a bug in this loop itself.
      try {
        for (const id of ids) {
          if (!inFlight.has(id)) startHeal({ id, deps, inFlight });
        }
      } catch (err) {
        deps.onHealError({ id: "*", err });
      }
    },
  };
}
