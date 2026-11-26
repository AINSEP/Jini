import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import type { AgentPluginSurfaceSummary } from "@jini-ai/admin/screens/plugins/hooks/agent-plugin-surfaces-port.hooks";
import type { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "@jini-ai/ui/fetch-query";
import { useCallback, useMemo, useState } from "react";

import type { AgentPluginListRow } from "@jini-ai/admin/agent-plugins/models";
import type { useContentRefreshSubscription } from "@jini-ai/admin/shell/hooks/use-content-refresh-subscription.hooks";

import type { AgentPluginsPort } from "@jini-ai/admin/screens/integrations/agent-plugin-ports";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file State for the Agent Plugins screen, so `AgentPlugins.tsx` is only markup — same split as
 * this directory's own `use-plugins.hooks.ts` (`Plugins.tsx`'s hook).
 *
 * REWRITTEN 2026-09-09: this hook used to return the static, checked-in `TOVU_BUNDLED_AGENT_PLUGINS`
 * constant with no I/O at all (the module's own prior header said so explicitly: "a port would be
 * ceremony with nothing to inject"). That premise is gone — `AGENT_PLUGINS_LIST`
 * (`server/inbound/admin-http/routes/agent-plugins/list.ts`) now exists, so this hook has a real
 * host boundary to inject, and gets the same `port` (`AgentPluginsPort`) / `useX(dependencies)` /
 * `useWiredX()` split `use-plugins.hooks.ts` already uses for this feature's sibling screen.
 *
 * EXTENDED 2026-09-09 (visual redesign): `onToggleEnabled` wires the row's enable/disable switch to
 * `AGENT_PLUGIN_SET_ENABLED`. That is a real activation write — `resolveAgentPluginRefs()` refuses a
 * run pinning a disabled plugin — so the switch's rendered position must always be server truth,
 * never an optimistic guess. See {@link useAgentPlugins}'s own `@tradeoffs`.
 *
 * `describeApiError` here is the shared default from `lib/api.ts`, not this feature's
 * `rules.ts` override — that override's `PLUGIN_NOT_FOUND`/`PLUGIN_INVALID`/`PLUGIN_INCOMPATIBLE`
 * codes belong to the `.tovu-plugin` enable/disable route this screen does not call. This screen's
 * own route answers `AGENT_PLUGIN_NOT_FOUND`/`VALIDATION_ERROR`, neither of which that override
 * knows, so the shared default (which surfaces the server's own message) is the better fit.
 *
 * `t` (standing i18n rule, 2026-08-11): resolved from `useAdminLocale()` in `useWiredAgentPlugins`
 * and returned as a bound `t`, rather than `AgentPlugins.tsx` calling `useAdminLocale()`/
 * `translatePlugins` directly.
 */

/** The minimal shape `AgentPluginDetailsModal` actually reads (`plugin.id`/`plugin.displayName`) —
 *  see that component's own narrowed prop type. Kept here, not re-exported from the deleted
 *  `agent-plugin-catalog.ts`, since nothing about it is bundle-specific anymore: any installed
 *  plugin's id plus a human-readable label is enough to open the inspector. */
export interface InspectedAgentPlugin {
  readonly maturity?: AgentPluginListRow["maturity"];
  readonly id: string;
  readonly displayName: string;
  /** Set by the row's "Manage" button: the screens it already listed, so the modal opens on the first. */
  readonly surfaces?: readonly AgentPluginSurfaceSummary[];
}

export interface AgentPluginsDependencies {
  useFetchQuery: typeof useFetchQuery; useFetchMutation: typeof useFetchMutation;
  useCachedLoader: typeof useCachedLoader; useInvalidate: typeof useInvalidate;
  useContentRefreshSubscription: typeof useContentRefreshSubscription;
  resource: string; toggleRefusalKeys: Readonly<Record<string, string>>;
  translatePlugins: (required: { locale: string; key: string }) => string;
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  isApiError: (error: unknown) => error is AdminHttpError;
  port: AgentPluginsPort;
  locale: string;
  t: Translate;
}

export interface AgentPluginsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  agentPlugins: AgentPluginListRow[] | null;
  error: string | null;
  /** The last failed toggle's message, or `null`. Separate from `error` (which means "the list
   *  itself could not load"), so a refused toggle does not blank the list the operator is reading. */
  toggleError: string | null;
  /** Plugin ids with an enable/disable request in flight right now. A `Set` rather than the sibling
   *  screen's single `rowSavingId` — see {@link useAgentPlugins}'s `@tradeoffs`. */
  togglingIds: ReadonlySet<string>;
  /** Flips one plugin's activation and replaces that row with the server's answer. */
  onToggleEnabled: (plugin: AgentPluginListRow) => Promise<void>;
  /** Adds (or replaces) the row the "Add a plugin" upload answered with, so no list re-fetch. */
  onInstalled: (plugin: AgentPluginListRow) => void;
  /** Plugin ids whose row detail panel (skills, MCP servers) is open. */
  expandedIds: ReadonlySet<string>;
  /** Opens or closes one row's detail panel. */
  onToggleExpanded: (required: { pluginId: string }, optional?: Record<string, never>) => void;
  /** The plugin currently open in the read-only package inspector, or `null` when it's closed. */
  inspectedPlugin: InspectedAgentPlugin | null;
  /** Opens the inspector for `plugin`. */
  inspectPlugin: (plugin: InspectedAgentPlugin) => void;
  /** Closes the inspector. */
  closeInspector: () => void;
  /** Bound translator — `AgentPlugins.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `AgentPlugins.tsx` passes it straight through
   *  to `I18nProvider`'s own `initialLocale`, not because anything here needs it beyond `t`. Same
   *  reasoning as `use-plugins.hooks.ts`'s own `locale` field. */
  locale: string;
}

/** Adds or removes one id, returning a new `Set` — so React sees an identity change. */
function withId({ ids, pluginId, present }: { ids: ReadonlySet<string>; pluginId: string; present: boolean }, _optional = {}): ReadonlySet<string> {
  const next = new Set(ids);
  if (present) next.add(pluginId);
  else next.delete(pluginId);
  return next;
}

/** `plugin` in place of the row with its id, keeping the list's order (an update must not move its
 *  row to the end), or appended when it is new. @complexity O(n) in row count. */
function withRow(required: { rows: readonly AgentPluginListRow[] | null; plugin: AgentPluginListRow }, _optional: Record<string, never> = {}): AgentPluginListRow[] {
  const { rows, plugin } = required;
  const current = rows ?? [];
  return current.some((entry) => entry.pluginId === plugin.pluginId)
    ? current.map((entry) => (entry.pluginId === plugin.pluginId ? plugin : entry))
    : [...current, plugin];
}

/** `plugin` in place of the row with its id, or `null` when no list is cached yet. A toggle never
 *  appends, and with nothing cached there is nothing on screen to update: writing `[]` there would
 *  win over the list read the toggle's own invalidation just started (`replace` beats an older
 *  in-flight read) and leave the screen on an empty list. @complexity O(n) in row count. */
function withToggledRow(required: { rows: readonly AgentPluginListRow[] | null; plugin: AgentPluginListRow }, _optional: Record<string, never> = {}): AgentPluginListRow[] | null {
  const { rows, plugin } = required;
  return rows ? rows.map((entry) => (entry.pluginId === plugin.pluginId ? plugin : entry)) : null;
}

/**
 * Loads the real installed Agent Plugins for this workspace on mount, and toggles one
 * plugin's activation at a time per row.
 *
 * @complexity One GET on mount, one PATCH per toggle, and GETs after invalidation (toggle,
 * install/uninstall, explicit reload or shared-query refresh). The PATCH response also replaces
 * its row in the shared cache; successful mutations invalidate the list for reconciliation.
 * @tradeoffs No optimistic flip. The switch shows only what the server has confirmed, so a refused
 * or failed toggle can never leave the operator looking at an "on" switch for a plugin that will
 * refuse the next run. The cost is one round-trip of visible latency, which the row's own
 * in-flight state covers.
 *
 * Row replacement reads the shared cache through `loader.peek()` rather than closing over the
 * array this render saw. Two rows toggled in quick succession settle independently, and a
 * settlement holding a stale array would otherwise revert the other row's newer answer.
 */
export function useAgentPlugins({ port, locale, t, useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription, resource, toggleRefusalKeys, translatePlugins, describeApiError, isApiError }: AgentPluginsDependencies, _optional: Record<string, never> = {}): AgentPluginsController {
  const key = useMemo(() => ["agent-plugins", "list"] as const, []);
  const fetchList = useCallback(async () => {
    try { return (await port.listAgentPlugins()).agentPlugins; }
    catch (error) { throw new Error(describeApiError({ e: error, fallback: translatePlugins({ locale, key: "failed to load agent plugins" }) })); }
  }, [port, locale, describeApiError, translatePlugins]);
  const query = useFetchQuery({ key, fetch: fetchList }, { staleTime: 0, refetchOnWindowFocus: true });
  const loader = useCachedLoader({ key, fetch: fetchList }, { staleTime: 0 });
  const agentPlugins = query.data ?? null;
  const setAgentPlugins = ({ update }: { update: (current: AgentPluginListRow[] | null) => AgentPluginListRow[] | null }, _optional = {}) => {
    const next = update(loader.peek() ?? null);
    if (next) loader.replace({ value: next });
  };
  const invalidate = useInvalidate();
  const toggle = useFetchMutation({ run: ({ input }: { input: AgentPluginListRow }) => port.setAgentPluginEnabled({ pluginId: input.pluginId, input: { enabled: !input.enabled } }) }, { invalidates: [["agent-plugins"]] });
  const error = query.error?.message ?? null;
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [inspectedPlugin, setInspectedPlugin] = useState<InspectedAgentPlugin | null>(null);

  const reload = useCallback(async () => { invalidate({ key: ["agent-plugins"] }); }, [invalidate]);

  // A completed assistant install/uninstall must update both tabs without a remount. The shared
  // generation guard prevents a slow earlier read resurrecting the just-removed package.
  useContentRefreshSubscription({ resource, onRefresh: () => { void reload(); } });

  async function onToggleEnabled(plugin: AgentPluginListRow): Promise<void> {
    // A second activation of this row's own switch while its request is outstanding is a no-op —
    // the same client-side single-flight discipline `usePlugins` uses, applied per row.
    if (togglingIds.has(plugin.pluginId)) return;
    setTogglingIds((ids) => withId({ ids, pluginId: plugin.pluginId, present: true }));
    setToggleError(null);
    try {
      const { agentPlugin } = await toggle.mutate({ input: plugin });
      setAgentPlugins({ update: (current) => withToggledRow({ rows: current, plugin: agentPlugin }) });
    } catch (e) {
      // Lifecycle refusals by name (409), in the operator's language rather than the server's English.
      const known = isApiError(e) && e.code ? toggleRefusalKeys[e.code] : undefined;
      setToggleError(known ? translatePlugins({ locale, key: known })
        : describeApiError({ e, fallback: translatePlugins({ locale: locale, key: "failed to update agent plugin" }) }));
    } finally {
      setTogglingIds((ids) => withId({ ids, pluginId: plugin.pluginId, present: false }));
    }
  }

  return {
    agentPlugins,
    error,
    toggleError,
    togglingIds,
    onToggleEnabled,
    onInstalled: (plugin: AgentPluginListRow) => {
      // The install response is newer than any pending list read. Keep its row until a later
      // refresh starts rather than letting an earlier snapshot hide the completed install.
      setAgentPlugins({ update: (current) => withRow({ rows: current, plugin }) });
    },
    expandedIds,
    onToggleExpanded: ({ pluginId }, _optional = {}) => setExpandedIds((ids) => withId({ ids, pluginId, present: !ids.has(pluginId) })),
    inspectedPlugin,
    inspectPlugin: setInspectedPlugin,
    closeInspector: () => setInspectedPlugin(null),
    t,
    locale,
  };
}

