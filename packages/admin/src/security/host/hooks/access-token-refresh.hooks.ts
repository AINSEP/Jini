import { useCallback, useState } from "react";
import { accessTokensLoadErrorMessage } from "../../security-i18n.js";
import type { AccessTokensArgs } from "./use-access-tokens.hooks.js";
import type { useAccessTokenQueries } from "./access-token-queries.hooks.js";
import type { useAccessTokenStores } from "./access-token-stores.hooks.js";
import { accessTokensLoadError, firstRejectionReason } from "./access-token-store-operations.js";

const UNKNOWN_ERROR = "unknown error";

// Set from a background reload (below) — merged into `loadError` so a failed refresh is as
// visible as a failed initial load, instead of the unhandled rejection this used to produce (LOW
// audit finding, 2026-09-03: `reloadAllStores` awaited all three stores with no `catch`).
// Flips true the first time ANY background reload completes (success or failure) — lets
// `loadError` below stop consulting `publishQuery.error`/`sourceControlQuery.error`/
// `customQuery.error` once a reload has run at all, since those three are frozen at whatever they
// were on the INITIAL fetch and nothing ever clears them afterward (2026-09-05 Gemini audit,
// verified: without this, an initial fetch failure showed a permanent error banner even after a
// later background reload fixed the problem, because `accessTokensLoadError(...) ?? reloadError`
// always prefers that stale, never-reset initial error over `reloadError`'s honest "no error"
// `null` — reordering the `??` would not have helped, since a successful reload also produces
// `null`, the exact value `??` treats as "keep checking further"; only gating on "has a reload
// happened at all" tells the difference between "no reload has run yet" and "the last reload
// succeeded").
// Monotonic per-attempt id (extracted into `useSettlementGeneration` 2026-09-06; see that hook's
// doc for why `use-static-publish.hooks.ts`'s own `previewGenerationRef` did NOT adopt it): a
// content-refresh notification can fire again while a previous reload is still in flight
// (2026-09-05 Gemini audit, verified: `useContentRefreshSubscription` invokes `triggerReload` — a
// fresh, ungated `reloadAllStores()` call every time — with no de-dupe of overlapping reloads),
// and network completion order does not have to match start order.
/**
 * Re-reads all three stores directly, bypassing `useFetchQuery`'s cache — an out-of-band write
 * (today `custom_credential_set_username`/`custom_credential_set_token`,
 * `apps/website/src/features/custom-credentials/agent-tools.ts`) has nothing to invalidate that
 * this hook would ever re-read: `publishQuery`/`sourceControlQuery`/`customQuery` only ever feed
 * the ONE-TIME seed effects above (`publishSeededRef` et al.), and every subsequent read this hook
 * shows the operator comes from `publishCredentials`/`sourceControlCredentials`/`customCredentials`
 * local state instead — the same reason `removeToken`/`makeDefault` already call
 * `port.*.list()`/`refetchStore` directly rather than `invalidate()`ing a query nothing re-seeds
 * from. Safe to overwrite unconditionally, unlike `use-settings-slice.hooks.ts`'s guarded
 * `refresh()`: a row's `existingDrafts`/`existingBusy` entry is keyed by row id in its OWN state,
 * not carried on the row itself, so replacing the row list here cannot clobber an operator's
 * in-progress edit or in-flight save the way overwriting a settings tab's single edited `value`
 * could.
 *
 * `Promise.allSettled`, not `Promise.all` (2026-09-05 Gemini audit, CONFIRMED): a `Promise.all`
 * rejects as soon as ANY of the three rejects, discarding the other two stores' already-resolved,
 * genuinely fresher results — a revoked token in a store that itself reloaded fine could keep
 * rendering as active because an unrelated store merely blipped. Each store here is applied
 * independently on its own success, and the first failure (if any) still surfaces through
 * `reloadError` via {@link firstRejectionReason} — no store's failure is silently swallowed, it
 * just no longer holds the other two hostage.
 *
 * Guarded by `settlement` (2026-09-05 Gemini audit, CONFIRMED): with no ordering guard, an older
 * reload that happens to resolve AFTER a newer one already committed its results would overwrite
 * the newer, correct data with its own now-stale snapshot. Every commit below (`if
 * (!settlement.isCurrent(requestGeneration)) return;`) is skipped whenever a newer
 * `reloadAllStores()` call has started since this one began.
 *
 * No longer wrapped in `try`/`catch` (the per-store settlement above is what used to need it) —
 * `triggerReload` below still calls this fire-and-forget (`void reloadAllStores()`, required by
 * `useContentRefreshSubscription`'s `onRefresh: () => void` contract), but nothing in this function
 * can now throw: `Promise.allSettled` itself never rejects.
 */
// Stable identity — see `use-media.hooks.ts`'s identical `invalidateList` note for why an inline
// arrow here would resubscribe `useContentRefreshSubscription` on every render for no benefit.
// Once a reload has completed at least once, `reloadError` alone is authoritative — see
// `hasReloadedOnce`'s own doc for why the initial-fetch errors below cannot be trusted past that
// point (they are never reset). Before any reload, this is unchanged from before: the initial
// load's own three-way priority, falling back to `reloadError` (still its initial `null`).

export function useAccessTokenRefresh({ args, queries, stores }: { args: AccessTokensArgs; queries: ReturnType<typeof useAccessTokenQueries>; stores: ReturnType<typeof useAccessTokenStores> }, _optional = {}) {
  const { port, locale, t, hooks, deps } = args;
  const { useSettlementGeneration, useContentRefreshSubscription } = hooks;
  const { describeApiError, ACCESS_TOKENS_RESOURCE } = deps;
  const { publishQuery, sourceControlQuery, customQuery } = queries;
  const { setPublishCredentials, setSourceControlCredentials, setCustomCredentials } = stores;
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [hasReloadedOnce, setHasReloadedOnce] = useState(false);
  const settlement = useSettlementGeneration();

  const reloadAllStores = useCallback(async () => {
    const requestGeneration = settlement.next();
    const results = await Promise.allSettled([port.publish.list(), port.sourceControl.list(), port.custom.list()]);
    if (!settlement.isCurrent({ generation: requestGeneration })) return; // superseded by a newer reload
    const [publishResult, sourceControlResult, customResult] = results;
    if (publishResult.status === "fulfilled") setPublishCredentials(publishResult.value.credentials);
    if (sourceControlResult.status === "fulfilled") setSourceControlCredentials(sourceControlResult.value.credentials);
    if (customResult.status === "fulfilled") setCustomCredentials(customResult.value.credentials);
    const failureReason = firstRejectionReason(results);
    setReloadError(failureReason === undefined ? null : accessTokensLoadErrorMessage({ locale, error: describeApiError({ e: failureReason, fallback: t(UNKNOWN_ERROR) }) }));
    setHasReloadedOnce(true);
  }, [port, locale, t]);

  const triggerReload = useCallback(() => {
    void reloadAllStores();
  }, [reloadAllStores]);
  useContentRefreshSubscription({ resource: ACCESS_TOKENS_RESOURCE, onRefresh: triggerReload });

  const loadError = hasReloadedOnce
    ? reloadError
    : (accessTokensLoadError({ deps, publishError: publishQuery.error, sourceControlError: sourceControlQuery.error, customError: customQuery.error, t, locale }) ?? reloadError);
  return { reloadAllStores, loadError };
}
