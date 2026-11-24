/** Local lifecycle writes and confirmation live in the controller, never in card markup. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { AdminLocalSiteAction, AdminSitesSnapshot } from "@jini-ai/core/contracts/site/admin-sites";
import { interpolate, type Translate } from "@jini-ai/core/text";
import { useInvalidate, type VisibilitySource } from "../../react/kit.js";
import type { SitesPort } from "./sites-port.hooks.js";

const nativeConfirm = ({ message }: { message: string }, _optional = {}) => window.confirm(message);
/** The actions that ask the operator first (Trash, permanent delete, Switch now, Stop on the serving site). */
export type ConfirmableLocalSiteAction = Extract<AdminLocalSiteAction, "trash" | "delete" | "switch" | "stop-serving">;

/** The two timer functions a visibility-aware interval uses, injectable for tests. */
export interface LocalSitesIntervalTimers {
  setInterval(required: { callback: () => void; ms: number }, optional?: Record<string, never>): unknown;
  clearInterval(required: { handle: unknown }, optional?: Record<string, never>): void;
}

/** What the host injects: its list cache key, its copy keys, its write-error rules and its interval. */
export interface LocalSitesDeps {
  /** The host's site-list cache key, invalidated after every write and on every poll tick. */
  listKey: QueryKey;
  /** The host's confirmation copy key per confirmable action; an action absent here runs unconfirmed. */
  confirmKeys: Readonly<Record<ConfirmableLocalSiteAction, string>>;
  /** The host's copy key appended to the Stop confirmation when a chat is running on the site. */
  servingChatWarningKey: string;
  /** The host's own copy key for a failed write's error code, or null to fall back. */
  siteWriteErrorKey(required: { e: unknown }, optional?: Record<string, never>): string | null;
  /** The host's shared API-error fallback describer. */
  describeApiError(required: { e: unknown; fallback: string }, optional?: Record<string, never>): string;
  /** Calls `tick` every `periodMs` while the document is visible; returns the stop function. */
  startVisibleInterval(required: { tick: () => void; periodMs: number }, optional?: { doc?: VisibilitySource | undefined; timers?: LocalSitesIntervalTimers | undefined }): () => void;
}

/** Whether an action asks the operator first (Trash, permanent delete, Switch now). */
function isConfirmable(action: AdminLocalSiteAction, confirmKeys: LocalSitesDeps["confirmKeys"]): action is ConfirmableLocalSiteAction {
  return action in confirmKeys;
}

/** Whether the snapshot's capabilities let `action` run at all: Switch now needs `canSwitchNow`,
 *  every other action needs local management, a permanent delete also needs its checkbox, and
 *  Stop on the serving site needs a site to hand its address to. */
function localActionAllowed(
  { action, canSwitchNow, enabled, deleteChecked, stopServingTarget }: { action: AdminLocalSiteAction; canSwitchNow: boolean; enabled: boolean; deleteChecked: boolean; stopServingTarget: string | null },
): boolean {
  if (action === "switch" ? !canSwitchNow : !enabled) return false;
  if (action === "stop-serving") return stopServingTarget !== null;
  return action !== "delete" || deleteChecked;
}

/** The confirmation body. Stop on the serving site names who takes over and warns about a chat,
 *  so a hand-over never cuts a chat off silently. @complexity O(1). */
function localActionConfirmMessage(
  { action, name, stopServing, t, deps }: { action: ConfirmableLocalSiteAction; name: string; stopServing: AdminSitesSnapshot["stopServing"]; t: Translate; deps: LocalSitesDeps },
): string {
  const message = t(deps.confirmKeys[action]);
  if (action !== "stop-serving") return message;
  const named = interpolate({ template: message, vars: { name, target: stopServing?.target ?? "" } });
  return stopServing?.chatRunning ? `${named} ${t(deps.servingChatWarningKey)}` : named;
}

/** Whether the host accepted Switch now and is restarting, rather than only saving the default. */
function restartAccepted({ result }: { result: unknown }, _optional = {}): boolean {
  return (result as { restarting?: boolean } | undefined)?.restarting === true;
}

/** The operator-facing message for a failed lifecycle write: the host's own copy for its codes,
 *  otherwise the host's shared `describeApiError` fallback. */
function localActionErrorMessage({ failure, t, deps }: { failure: unknown; t: Translate; deps: LocalSitesDeps }, _optional = {}): string {
  const key = deps.siteWriteErrorKey({ e: failure });
  if (key) return t(key);
  return deps.describeApiError({ e: failure instanceof Error ? failure : new Error("Request failed"), fallback: t("That request failed.") });
}

/** Only an enabled local host with an unfinished start needs startup polling. */
function localSiteIsStarting({ enabled, snapshot }: { enabled: boolean; snapshot: AdminSitesSnapshot | undefined }): boolean {
  return enabled && snapshot?.localSites?.some(site => site.status === "starting") === true;
}

/** DI confirms allow cancellation and double-click tests without mocking browser modules.
 * Restart refreshes use the live binding, stop after 60 seconds, and release on unmount.
 * @complexity O(1) state and work per tick; invalidation reuses the cached Sites read.
 */
export function useLocalSites(
  { port, snapshot, t, deps }: { port: SitesPort; snapshot: AdminSitesSnapshot | undefined; t: Translate; deps: LocalSitesDeps },
  { confirm = nativeConfirm, visibility = document, timers }: {
    /** Receives the translated message plus the action, so a modal can title and tone itself. */
    confirm?: (required: { message: string; action: ConfirmableLocalSiteAction }, optional?: Record<string, never>) => boolean | Promise<boolean>;
    /** Visibility and timer ports keep lifecycle polling testable without replacing modules. */
    visibility?: VisibilitySource;
    timers?: LocalSitesIntervalTimers;
  } = {},
) {
  const invalidate = useInvalidate();
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [switchTarget, setSwitchTarget] = useState<{ name: string; deadline: number } | null>(null);
  const busy = useRef(false);
  const { enabled, canSwitchNow, stopServing, stopServingTarget, activeSiteName } = localSiteCapabilities(snapshot);
  const refresh = useCallback(() => invalidate({ key: deps.listKey }), [invalidate, deps.listKey]);
  const starting = localSiteIsStarting({ enabled, snapshot });
  useLocalSitePolling({ starting, switchTarget, activeSiteName, refresh, visibility, timers, setSwitchTarget, startVisibleInterval: deps.startVisibleInterval });
  function handleSwitchResult({ name, result }: { name: string; result: unknown }, _optional = {}) {
    const url = (result as { url?: unknown } | undefined)?.url;
    if (typeof url === "string") port.openSite?.({ url });
    else if (restartAccepted({ result: result })) setSwitchTarget({ name, deadline: Date.now() + 60_000 });
    else setError(t("This host could not switch now. The default is saved for the next launch."));
  }
  const run = useCallback(async (name: string, action: AdminLocalSiteAction) => {
    if (busy.current || !port.manageLocalSite) return;
    if (!localActionAllowed({ action, canSwitchNow, enabled, deleteChecked: checked[name] === true, stopServingTarget })) return;
    busy.current = true;
    setBusyName(name); setError(null);
    try {
      if (isConfirmable(action, deps.confirmKeys) && !(await confirm({ message: localActionConfirmMessage({ action, name, stopServing, t, deps }), action }))) return;
      const result = await port.manageLocalSite({ name, action, confirmed: true, checked: checked[name] === true });
      applyLocalSiteActionResult({ action, name, stopServingTarget }, result, handleSwitchResult);
      refresh();
    } catch (failure) {
      setError(localActionErrorMessage({ failure: failure, t: t, deps }));
    }
    finally { busy.current = false; setBusyName(null); }
  }, [port, canSwitchNow, enabled, stopServing, stopServingTarget, checked, confirm, t, deps, refresh]);
  const toggleChecked = useCallback((id: string, value: boolean) => setChecked((current) => ({ ...current, [id]: value })), []);
  return { busyName, error, checked, toggleChecked, run };
}

function localSiteCapabilities(snapshot: AdminSitesSnapshot | undefined) {
  const enabled = snapshot?.localManagementEnabled === true;
  const canSwitchNow = snapshot?.canSwitchNow === true;
  const stopServing = snapshot?.stopServing;
  const stopServingTarget = stopServing?.available === true ? stopServing.target : null;
  const activeSiteName = snapshot?.currentSite.name;
  return { enabled, canSwitchNow, stopServing, stopServingTarget, activeSiteName };
}

function useLocalSitePolling({ starting, switchTarget, activeSiteName, refresh, visibility, timers, setSwitchTarget, startVisibleInterval }: {
  starting: boolean; switchTarget: { name: string; deadline: number } | null; activeSiteName: string | undefined;
  refresh: () => void; visibility: VisibilitySource; timers: LocalSitesIntervalTimers | undefined;
  setSwitchTarget: (target: { name: string; deadline: number } | null) => void;
  startVisibleInterval: LocalSitesDeps["startVisibleInterval"];
}) {
  // Idle hosts need no timer. Refresh only an unfinished start or accepted restart; broad
  // idle invalidation used to refetch shares and publish permissions every three seconds.
  useEffect(() => {
    if (switchTarget && activeSiteName === switchTarget.name) {
      setSwitchTarget(null);
      return undefined;
    }
    if (!starting && !switchTarget) return undefined;
    // Replace the slow poll while a restart is pending; a saved default alone is not completion.
    return startVisibleInterval({ tick: () => {
      if (switchTarget && Date.now() >= switchTarget.deadline) setSwitchTarget(null);
      refresh();
    }, periodMs: switchTarget ? 300 : 3000 }, { doc: visibility, timers });
  }, [starting, switchTarget, activeSiteName, refresh, visibility, timers, startVisibleInterval]);
}

function applyLocalSiteActionResult(
  { action, name, stopServingTarget }: { action: AdminLocalSiteAction; name: string; stopServingTarget: string | null },
  result: unknown, handleSwitchResult: (required: { name: string; result: unknown }) => void,
): void {
  if (action === "switch") handleSwitchResult({ name: name, result: result });
  // The server restarts onto the hand-over target, so the page waits for that site, not this one.
  if (action === "stop-serving" && stopServingTarget !== null) handleSwitchResult({ name: stopServingTarget, result: result });
}

export type LocalSitesController = ReturnType<typeof useLocalSites>;
