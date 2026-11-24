import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedLoader, useFetchMutation, useFetchQuery } from "../../react/kit.js";
import type { useConfirmRequest } from "../../react/components/ConfirmDialog/use-confirm-request.js";
import type { publishSettingsRefresh, subscribeToSettingsRefresh } from "../../shell/lib/settings-refresh-bus.js";
import { useAdminBootScope } from "../../shell/lib/admin-boot-scope.js";
type Grant = { enabled: boolean; canEdit: boolean };
export interface SiteGrantPort<T extends Grant> {
  read(required: Record<string, never>, optional?: Record<string, never>): Promise<T>;
  write(required: Omit<T, "canEdit"> & { riskAcknowledged: boolean }, optional?: Record<string, never>): Promise<T>;
}
/** The host's settings-refresh feed: `subscribe` re-reads on a matching namespace, `publish` names this grant after a save. */
export interface OwnerGrantRefresh {
  subscribe: typeof subscribeToSettingsRefresh;
  publish: typeof publishSettingsRefresh;
}
/** Everything the host binds once for every owner grant: confirmation hook, refresh feed and error copy. */
export interface OwnerGrantDependencies {
  useConfirmation: typeof useConfirmRequest;
  refresh: OwnerGrantRefresh;
  /** The host's own error-to-copy rule; `fallback` is the grant's `failure` string. */
  describeError: (required: { error: unknown; fallback: string }, optional?: Record<string, never>) => string;
}
/** Pure consent policy: only an OFF-to-ON change asks, unless the host opts its grant out.
 * @param required - The requested and the current server `enabled` value.
 * @param optional - The host's per-grant enable policy; only an explicit `false` skips consent.
 * @returns Whether the owner must confirm before the write (also its `riskAcknowledged` value).
 * @complexity O(1). */
function enableNeedsConsent(required: { next: boolean; current: boolean }, optional: { confirmEnable?: boolean } = {}) {
  return optional.confirmEnable !== false && required.next && !required.current;
}
// The refresh feed arrives as the required `refresh` field (OwnerGrantRefresh).
/** Both site grants use Jini's query/invalidation owner and cache lifecycle.
 * @param required - Injected authenticated API and cache/namespace identity.
 * @returns Server truth, its load error and a shared cache-replacement port; subscribes until unmount.
 * @example useAssistantOwnerGrantSettings({ port, namespace, key });
 * @complexity O(1) hook state plus bounded API payload; one read per invalidation. */
export function useAssistantOwnerGrantSettings<T extends Grant>(required: { port: SiteGrantPort<T>; namespace: string; key: readonly string[]; refresh: Pick<OwnerGrantRefresh, "subscribe"> }, _optional = {}) {
  const { queryScope, checking } = useAdminBootScope();
  const key = useMemo(() => [...required.key, queryScope], [required.key, queryScope]);
  const fetchSettings = useCallback(() => required.port.read({}), [required.port]);
  const query = useFetchQuery({ key, fetch: fetchSettings }, { enabled: !checking, staleTime: Infinity });
  const loader = useCachedLoader({ key, fetch: fetchSettings }, { staleTime: Infinity });
  const refetch = query.refetch;
  const subscribe = required.refresh.subscribe;
  useEffect(() => subscribe(namespaces => {
    if (namespaces === null || namespaces.includes(required.namespace)) refetch();
  }), [subscribe, refetch, required.namespace]);
  return { settings: query.data ?? null, loadError: query.error?.message ?? null, loader };
}
// The confirmation hook, refresh feed and error copy arrive as required fields (OwnerGrantDependencies).
/** Host owner policy around Jini confirmation/mutation. The lock spans any consent and persistence,
 * so repeated toggle clicks cannot issue overlapping grant changes. A rejected write retains
 * server truth; only successful responses update the shared dock/panel query.
 * @param required - API/copy/cache ports for a specific site-owner grant.
 * @param optional - Injectable Jini confirmation hook and the host's per-grant enable policy.
 * @returns Controller; save errors retain server truth and expose the actual API error.
 * @example useAssistantOwnerGrant({ port, namespace, key, title, dangers, confirmLabel, failure });
 * @complexity O(1) per change plus bounded setting serialization; no optimistic grant. */
export function useAssistantOwnerGrant<T extends Grant>(required: OwnerGrantDependencies & {
  port: SiteGrantPort<T>; namespace: string; key: readonly string[]; title: string;
  dangers: readonly string[]; confirmLabel: string; failure: string; t?: (key: string) => string;
}, optional: { confirmEnable?: boolean } = {}) {
  const t = required.t ?? ((key: string) => key);
  const state = useAssistantOwnerGrantSettings(required);
  const confirmation = required.useConfirmation({});
  const mutation = useFetchMutation({ run: ({ input }: { input: Omit<T, "canEdit"> & { riskAcknowledged: boolean } }) => required.port.write(input) });
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  type SaveInput = { settings: Omit<T, "canEdit">; confirmation?: Parameters<ReturnType<typeof useConfirmRequest>["confirm"]>[0]["dialog"] };
  async function requestConsent({ input, current }: { input: SaveInput; current: T }, _options = {}) {
    const acknowledged = input.confirmation !== undefined || enableNeedsConsent({ next: input.settings.enabled, current: current.enabled }, optional);
    const allowed = !acknowledged || await confirmation.confirm({ dialog: input.confirmation ?? {
      title: t(required.title), body: required.dangers.map(t).join("\n"),
      confirmLabel: t(required.confirmLabel), cancelLabel: t("Cancel"), tone: "danger",
    } });
    return { allowed, acknowledged };
  }
  async function save(input: SaveInput, _options = {}) {
    const current = state.settings;
    if (locked.current || !current?.canEdit || state.loadError) return;
    locked.current = true; setBusy(true); setSaveError(null);
    try {
      const consent = await requestConsent({ input, current });
      if (!consent.allowed) return;
      const saved = await mutation.mutate({ input: { ...input.settings, riskAcknowledged: consent.acknowledged } });
      state.loader.replace({ value: saved });
      required.refresh.publish([required.namespace]);
    } catch (error) { setSaveError(required.describeError({ error, fallback: required.failure })); }
    finally { locked.current = false; setBusy(false); }
  }
  return { ...state, busy, saveError, save, dialog: { ...confirmation.dialog, onCancel: () => {
    // Keep the opener enabled while the modal owns focus so cancellation can restore it.
    // Release the UI's waiting state in the same commit that closes consent. Otherwise the
    // native dialog tries to restore focus while its opener is temporarily disabled.
    // The synchronous lock remains held until save's finally block, so re-entry stays denied.
    setBusy(false);
    confirmation.dialog.onCancel();
  } } };
}
