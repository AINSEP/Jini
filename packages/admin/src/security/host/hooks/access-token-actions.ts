import type { AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlCredentialSummary } from "../../../source-control/api/source-control-api.types.js";
import { accessTokenMakeDefaultErrorMessage, accessTokenRemoveErrorMessage } from "../../security-i18n.js";
import { type AccessTokenKind, type AccessTokenRow } from "../../access-token-rows.js";
import type { AccessTokensArgs, DraftFields } from "./use-access-tokens.hooks.js";
import { blankDraft, IDLE } from "./access-token-state.hooks.js";
import { writeCredential, mergeRaw, accessTokenActionErrorMessage } from "./access-token-store-operations.js";
import type { useAccessTokenQueries } from "./access-token-queries.hooks.js";
import type { useAccessTokenStores } from "./access-token-stores.hooks.js";
import type { useAccessTokenDrafts } from "./access-token-drafts.hooks.js";
import type { useAccessTokenRefresh } from "./access-token-refresh.hooks.js";

export interface AccessTokenActionContext {
  args: AccessTokensArgs;
  queries: ReturnType<typeof useAccessTokenQueries>;
  stores: ReturnType<typeof useAccessTokenStores>;
  drafts: ReturnType<typeof useAccessTokenDrafts>;
  refresh: ReturnType<typeof useAccessTokenRefresh>;
  rows: AccessTokenRow[] | undefined;
}

const UNKNOWN_ERROR = "unknown error";

  /** Applies explicit site opt-in through the shared attachment owner, then refreshes metadata.
   * Per-key pending guards prevent duplicate clicks; failures leave usage unchanged and visible.
   * @complexity O(n log n) refresh time and O(n) space for n saved keys; no per-key HTTP requests.
   */
export async function setCustomKeyUse({ context, row, use }: { context: AccessTokenActionContext; row: AccessTokenRow; use: boolean }, _optional = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t } = context.args;
  const { describeApiError } = deps;
  const { setCustomKeyBusy, customKeyPending } = context.drafts;
  const { reloadAllStores } = context.refresh;
    if (row.scope !== "project" || customKeyPending.current.has(row.id)) return;
    customKeyPending.current.add(row.id);
    setCustomKeyBusy(prev => ({ ...prev, [row.id]: { saving: true, error: null } }));
    try {
      await port.custom.useKey({ keyId: row.id, use });
      await reloadAllStores();
      setCustomKeyBusy(prev => ({ ...prev, [row.id]: IDLE }));
    } catch (err) {
      setCustomKeyBusy(prev => ({ ...prev, [row.id]: { saving: false, error: describeApiError({ e: err, fallback: t(UNKNOWN_ERROR) }) } }));
    } finally {
      customKeyPending.current.delete(row.id);
    }
  }

export function mergeCredential({ context, kind, result, isNew }: { context: AccessTokenActionContext; kind: AccessTokenKind; result: AdminPublishCredentialSummary | AdminSourceControlCredentialSummary; isNew: boolean }, _optional: Record<string, never> = {}): void {
  const { setPublishCredentials, setSourceControlCredentials } = context.stores;
    if (kind === "publish") {
      const row = result as AdminPublishCredentialSummary;
      setPublishCredentials((prev) => mergeRaw({ list: prev ?? [], result: row, isNew }));
    } else {
      const row = result as AdminSourceControlCredentialSummary;
      setSourceControlCredentials((prev) => mergeRaw({ list: prev ?? [], result: row, isNew }));
    }
  }

async function refetchStore({ context, kind }: { context: AccessTokenActionContext; kind: AccessTokenKind }, _optional: Record<string, never> = {}): Promise<void> {
  const { port } = context.args;
  const { setPublishCredentials, setSourceControlCredentials } = context.stores;
    if (kind === "publish") setPublishCredentials((await port.publish.list()).credentials);
    else setSourceControlCredentials((await port.sourceControl.list()).credentials);
  }

  /** Seeds a row's FIRST draft update from the persisted row (name AND username included), not a
   *  blank draft — fixes a HIGH audit finding (2026-08-19 Codex sol bug/architecture audit): the
   *  previous `prev[rowId] ?? blankDraft()` fallback seeded `name: ""` whenever Token/Account/Username
   *  was the first field touched, so the very next render displayed a cleared Name field and disabled
   *  Save until the user retyped it — see {@link existingRowState}'s own analogous, already-correct
   *  fallback (`row.name`), which this now matches. Username joined this same fallback on 2026-09-01:
   *  once a custom row can carry a saved {@link AccessTokenRow.username}, touching Token first (before
   *  ever touching Username) would otherwise blank a saved username out of the draft the identical way
   *  it used to blank Name. @complexity O(1). */
export function setExistingField({ context, rowId, patch }: { context: AccessTokenActionContext; rowId: string; patch: Partial<DraftFields> }, _optional: Record<string, never> = {}): void {
  const deps = context.args.deps;
  const { locale } = context.args;
  const { credentialDraftError } = deps;
  const { setExistingDrafts, setExistingBusy } = context.drafts;
  const { rows } = context;
    const token = patch.token;
    if (token !== undefined) setExistingBusy(prev => ({ ...prev, [rowId]: { saving: prev[rowId]?.saving ?? false, error: credentialDraftError({ value: token }, { locale }) } }));
    setExistingDrafts((prev) => {
      const existing = prev[rowId];
      if (existing) return { ...prev, [rowId]: { ...existing, ...patch } };
      const persistedRow = rows?.find((r) => r.id === rowId);
      return { ...prev, [rowId]: { ...blankDraft(), name: persistedRow?.name ?? "", username: persistedRow?.username ?? "", worksFor: persistedRow?.worksFor ?? [], ...patch } };
    });
  }

  /** Removes a saved row, now with real error handling (Terra audit MEDIUM finding, 2026-08-19):
   *  this used to await the API call with no `try`/`catch`, per-row busy/error state, or caught
   *  rejection at all — a normal failure (auth, network, server error) produced an unhandled
   *  rejection and left the operator staring at a row that looked untouched, with no way to tell
   *  the remove had not applied. A rejection now lands in {@link existingBusy}, the SAME per-row
   *  state {@link replaceToken} already renders through `state.error` — no new UI surface needed.
   *  @complexity O(1) plus one network round trip. */
export async function removeToken({ context, row }: { context: AccessTokenActionContext; row: AccessTokenRow }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { setCustomCredentials } = context.stores;
  const { setExistingBusy } = context.drafts;
    setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: true, error: null } }));
    try {
      if (row.kind === "custom") {
        await port.custom.remove({ id: row.id });
        setCustomCredentials((await port.custom.list()).credentials);
      } else {
        if (row.kind === "publish") await port.publish.remove({ id: row.id });
        else await port.sourceControl.remove({ id: row.id });
        await refetchStore({ context, kind: row.kind });
      }
      setExistingBusy((prev) => ({ ...prev, [row.id]: IDLE }));
    } catch (err) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenActionErrorMessage({ deps, err, t, locale, template: accessTokenRemoveErrorMessage }) } }));
    }
  }

  /** Splices the server-confirmed promotion into the right store's local state, via
   *  `deployment/rules.ts`'s `withPromotedDefault` — the `makeDefault` counterpart of
   *  {@link mergeCredential}. Reused rather than reimplemented (terra review 2026-09-20): the old
   *  `makeDefault` treated the write AND the reconcile refetch below as one unit inside a single
   *  try/catch, so a refetch that failed on its own (a real, separate network call) reported the
   *  WHOLE promotion as failed and left the pre-promotion list on screen, even though the server had
   *  already confirmed it. `custom` rows never reach `makeDefault` (`AccessTokensTab.tsx`'s
   *  `TokenRowDefaultIndicator` never renders a "Make default" control for a singleton custom group),
   *  so only the two branches `refetchStore` itself already handles are needed here.
   *  @complexity O(1) dispatch; O(n) inside `withPromotedDefault`. */
function applyPromotedDefault({ context, kind, result }: { context: AccessTokenActionContext; kind: AccessTokenKind; result: AdminPublishCredentialSummary | AdminSourceControlCredentialSummary }, _optional: Record<string, never> = {}): void {
  const deps = context.args.deps;
  const { withPromotedDefault } = deps;
  const { setPublishCredentials, setSourceControlCredentials } = context.stores;
    if (kind === "publish") setPublishCredentials((prev) => withPromotedDefault({ credentials: prev ?? [], promoted: result as AdminPublishCredentialSummary }));
    else setSourceControlCredentials((prev) => withPromotedDefault({ credentials: prev ?? [], promoted: result as AdminSourceControlCredentialSummary }));
  }

  /** Best-effort re-read after a promotion the server already confirmed — same shape and reasoning as
   *  `use-publish-credentials.hooks.ts`'s `reconcileCredentials`: a failure here is swallowed because
   *  {@link applyPromotedDefault} already applied the server's own confirmed response, so surfacing an
   *  error would falsely tell the operator the promotion itself failed. */
async function reconcileStore({ context, kind }: { context: AccessTokenActionContext; kind: AccessTokenKind }, _optional: Record<string, never> = {}): Promise<void> {
    try {
      await refetchStore({ context, kind: kind });
    } catch {
      // See this function's doc — the confirmed local promotion (applyPromotedDefault) stands.
    }
  }

  /** Same error-handling fix as {@link removeToken}'s own doc, for the "Make default" action. */
export async function makeDefault({ context, row }: { context: AccessTokenActionContext; row: AccessTokenRow }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = context.args.deps;
  const { port, t, locale } = context.args;
  const { setExistingBusy } = context.drafts;
    if (row.isDefault) return;
    setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: true, error: null } }));
    try {
      const result = await writeCredential({ port, kind: row.kind, mode: { type: "update", id: row.id }, patch: { isDefault: true } });
      applyPromotedDefault({ context, kind: row.kind, result });
      await reconcileStore({ context, kind: row.kind });
      setExistingBusy((prev) => ({ ...prev, [row.id]: IDLE }));
    } catch (err) {
      setExistingBusy((prev) => ({ ...prev, [row.id]: { saving: false, error: accessTokenActionErrorMessage({ deps, err, t, locale, template: accessTokenMakeDefaultErrorMessage }) } }));
    }
  }

