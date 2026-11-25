import { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "../../../react/kit.js";
import { useCallback, useMemo, useState } from "react";

import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import type { PluginRules, PluginsLocaleTranslate } from "../rules.js";

import { useContentRefreshSubscription } from "../../../shell/hooks/use-content-refresh-subscription.hooks.js";
import type { PluginsPort } from "./plugins-port.hooks.js";
import { usePluginInstall, type IsInstallApiError, type PluginInstallController } from "./use-plugin-install.hooks.js";
import type { PluginInstallPort } from "./plugin-install-port.hooks.js";

import { interpolate, type Translate } from '@jini-ai/core/text';
/**
 * @file Everything the Plugins list does, so `Plugins.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings.
 * `describeApiError` (this screen's server-error-code overrides) moved to `rules.ts` alongside the
 * toggle-cell decision; this hook imports it back for its own async handlers.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/plugins` needs it.
 *
 * `deps.port` is injected (see `plugins-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly — the same `useX(dependencies)` / `useWiredX()` split `redirects`/`widgets` use.
 * The host's plugins dictionary lookup — passed in as `translate` to avoid colliding with this
 * file's own bound `(key) => string` closure — serves this hook's OWN error strings: a pure
 * `DICT[locale]?.[key] ?? key` lookup with no host boundary, same "pure, no-I/O"
 * category the convention doc names for `describeApiError`.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): injected so `Plugins.tsx` sources its UI
 * copy from this hook instead of its own `useAdminLocale()`/`translatePlugins` import.
 *
 * `expandedIds`/`onToggleExpanded` moved here (2026-09-10) from a bare `useState` directly in
 * `Plugins.tsx` — this admin's own rule that component logic belongs in `hooks/`, not `.tsx`, same
 * split the sibling `use-agent-plugins.hooks.ts` already draws for `AgentPlugins.tsx`. The Remove
 * confirm dialog's target (`pendingRemovePlugin`) followed on 2026-09-13, the same way
 * `inspectedPlugin` had already arrived: it was the last `useState` left in `Plugins.tsx`.
 *
 * Concurrent toggles on different rows can overlap their list refreshes. The shared query
 * cache now owns the latest-request settlement guard formerly held by useSettlementGeneration:
 * late successes and failures cannot overwrite a newer read. Successful reads clear prior query
 * errors, so a transient refresh failure cannot leave Plugins.tsx's fatal error screen stuck.
 */

export interface PluginsDependencies {
  installPort: PluginInstallPort;
  port: PluginsPort;
  locale: string;
  t: Translate;
  /** The host's plugins dictionary lookup (`{ locale, key }`), for this hook's own failure fallbacks. */
  translate: PluginsLocaleTranslate;
  /** The host's API-error test, handed to the install controller. */
  isApiError: IsInstallApiError;
  /** The host's bound rule functions. */
  rules: Pick<PluginRules, "describeApiError" | "pluginInstallPreviewDisplay" | "PLUGINS_RESOURCE">;
}

export interface PluginsController {
  install?: PluginInstallController;
  canInstallFolder?: boolean;
  /** `null` until the initial load settles — the caller renders a loading state. */
  plugins: AdminPluginDto[] | null;
  error: string | null;
  rowError: string | null;
  /** In-flight enable/disable OR remove request, keyed by plugin id — one at a time, one row action
   *  at a time overall (a remove in flight on one row and a toggle in flight on another still share
   *  this single field). See `usePlugins`'s own `@tradeoffs` note for what that gives up. */
  rowSavingId: string | null;
  onToggleEnabled: (plugin: AdminPluginDto) => Promise<void>;
  /** Deletes a `"site"` plugin's on-disk artifact via `PLUGIN_UNINSTALL` and re-fetches the list —
   *  the Downloaded tab's Remove control, gated behind `PluginRemoveConfirmDialog` before this is
   *  ever called (see {@link PluginsController.onConfirmRemove}). Refused by the server for a
   *  `"built-in"` plugin or one still enabled somewhere; either refusal lands in `rowError` via the
   *  same `describeApiError` path `onToggleEnabled` already uses. */
  onRemovePlugin: (plugin: AdminPluginDto) => Promise<void>;
  /** Plugin ids whose row detail panel (quarantine/errors) is open. Same shape and home as the
   *  sibling `use-agent-plugins.hooks.ts`'s `AgentPluginsController.expandedIds` — moved here
   *  (2026-09-10) from a bare `useState` in `Plugins.tsx`. */
  expandedIds: ReadonlySet<string>;
  /** Opens or closes one row's detail panel. */
  onToggleExpanded: (required: { id: string }, optional?: Record<string, never>) => void;
  /** The plugin open in `PluginPackageFilesModal`, looked up fresh from `plugins` by id so a reload
   *  never shows a stale row; `null` while the viewer is closed. */
  inspectedPlugin: AdminPluginDto | null;
  /** Opens the package-files viewer for one plugin (a row's eye button, on either list tab). */
  onInspectPlugin: (id: string) => void;
  onCloseInspector: () => void;
  /** The provider plugin open in `PluginProviderSettingsDialog` (looked up fresh, like `inspectedPlugin`). */
  settingsPlugin: AdminPluginDto | null;
  /** Opens a provider plugin's settings card (a row's Settings button, when it declares settings). */
  onOpenSettings: (id: string) => void;
  onCloseSettings: () => void;
  /** The settings card saved: closes it and sets {@link PluginsController.settingsNotice}. */
  onSettingsSaved: () => void;
  /** "<Name> settings saved", shown as a toast until dismissed or timed out. */
  settingsNotice: string | null;
  dismissSettingsNotice: () => void;
  /** The plugin waiting on `PluginRemoveConfirmDialog`, looked up fresh from `plugins` by id (same as
   *  `inspectedPlugin`), so the confirmed row is always the current one; `null` while it's closed. */
  pendingRemovePlugin: AdminPluginDto | null;
  /** Opens the confirm dialog for one row (Downloaded's Remove button). Nothing is deleted yet. */
  onRequestRemove: (plugin: AdminPluginDto) => void;
  /** Closes the dialog, then runs {@link PluginsController.onRemovePlugin} for `plugin`. */
  onConfirmRemove: (plugin: AdminPluginDto) => void;
  /** Closes the dialog without removing anything. */
  onCancelRemove: () => void;
  /** Bound translator — `Plugins.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `rules.ts`'s `pluginToggleControl` genuinely
   *  needs it, not `t`. */
  locale: string;
}

/** Adds or removes one id, returning a new `Set` — so React sees an identity change. Same helper,
 *  independently kept, as `use-agent-plugins.hooks.ts`'s own `withId` — this feature's established
 *  precedent (`rules.ts`'s `humanizeAgentPluginId`) is a private per-screen copy over a shared
 *  cross-screen import for a two-line pure function. */
function withId({ ids, id, present }: { ids: ReadonlySet<string>; id: string; present: boolean }, _optional = {}): ReadonlySet<string> {
  const next = new Set(ids);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

function findPluginById({ plugins, id }: {
  plugins: AdminPluginDto[] | null;
  id: string | null;
}, _optional = {}): AdminPluginDto | null {
  return plugins?.find((plugin) => plugin.id === id) ?? null;
}

/**
 * Loads the plugin list and toggles one plugin's activation at a time.
 *
 * @complexity One GET on mount plus one PATCH + one re-fetch GET per successful toggle.
 * @tradeoffs In-flight state is a single `rowSavingId` (ui.spec.md §0 mandates mirroring
 * `Roles.tsx`), so toggling a second row while the first is still in flight re-enables the first
 * row's button — EC-11's single-flight guarantee is per-row-at-a-time, not per-row-concurrent. A
 * `Set` of in-flight ids would close that, at the cost of diverging from the mandated convention.
 * What is NOT part of that tradeoff, and is guarded below: the row whose request is still on the
 * wire must never be unlocked by an UNRELATED row's request settling — see both `finally` blocks.
 * @overallScore 92
 */
export function usePlugins({ port, locale, t, installPort, translate, isApiError, rules }: PluginsDependencies): PluginsController {
  const {
    loader, plugins, canInstallFolder, write, error, rowError, setRowError, rowSavingId, setRowSavingId, expandedIds, setExpandedIds, inspectedPluginId,
    setInspectedPluginId, settingsPluginId, setSettingsPluginId, settingsNotice, setSettingsNotice, pendingRemoveId, setPendingRemoveId, reload,
  } = usePluginsState({ port, locale, t, translate, rules });
  const { onToggleEnabled, onRemovePlugin } = createPluginActions({ rowSavingId, setRowSavingId, setRowError, write, port, loader, locale, t, translate, rules });

  const install = usePluginInstall({ port: installPort, t, onInstalled: reload, isApiError, rules });

  return {
    install,
    canInstallFolder,
    plugins,
    error,
    rowError,
    rowSavingId,
    onToggleEnabled,
    onRemovePlugin,
    expandedIds,
    onToggleExpanded: ({ id }, _optional = {}) => setExpandedIds((ids) => withId({ ids, id, present: !ids.has(id) })),
    inspectedPlugin: findPluginById({ plugins, id: inspectedPluginId }),
    onInspectPlugin: setInspectedPluginId,
    onCloseInspector: () => setInspectedPluginId(null),
    settingsPlugin: findPluginById({ plugins, id: settingsPluginId }),
    onOpenSettings: setSettingsPluginId,
    onCloseSettings: () => setSettingsPluginId(null),
    onSettingsSaved: () => {
      const name = findPluginById({ plugins, id: settingsPluginId })?.name ?? settingsPluginId ?? "";
      setSettingsPluginId(null);
      setSettingsNotice(interpolate({ template: t("{name} settings saved"), vars: { name } }));
    },
    settingsNotice,
    dismissSettingsNotice: () => setSettingsNotice(null),
    pendingRemovePlugin: findPluginById({ plugins, id: pendingRemoveId }),
    onRequestRemove: (plugin: AdminPluginDto) => setPendingRemoveId(plugin.id),
    onConfirmRemove: (plugin: AdminPluginDto) => {
      setPendingRemoveId(null);
      void onRemovePlugin(plugin);
    },
    onCancelRemove: () => setPendingRemoveId(null),
    t,
    locale,
  };
}

function createPluginActions(
  { rowSavingId, setRowSavingId, setRowError, write, port, loader, locale, t, translate, rules }:
    Pick<ReturnType<typeof usePluginsState>, "rowSavingId" | "setRowSavingId" | "setRowError" | "write" | "loader"> &
    Pick<Parameters<typeof usePlugins>[0], "port" | "locale" | "t" | "translate" | "rules">
) {
  async function onToggleEnabled(plugin: AdminPluginDto) {
    // EC-11: a second activation of this row's own toggle while its request is outstanding is a
    // no-op — the client-side single-flight discipline is the guard, no `Idempotency-Key` is sent.
    if (rowSavingId === plugin.id) return;
    setRowSavingId(plugin.id);
    setRowError(null);
    try {
      await write.mutate({ input: () => port.setPluginEnabled({ id: plugin.id, patch: { enabled: !plugin.enabled } }) });
      await loader.load().catch(() => {}); // Join invalidation before unlocking; query.error owns a failed read.
    } catch (e) {
      setRowError(rules.describeApiError({ e, fallback: translate({ locale: locale, key: "failed to update plugin" }) }, { translate: t }));
    } finally {
      // Only clear THIS row's lock — `rowSavingId` is shared with `onRemovePlugin`, and the EC-11
      // guard above is per-row, so a second row's action starts freely while this one is still
      // outstanding. An unconditional `setRowSavingId(null)` here would re-enable THAT row's control
      // the moment this request settled, while its own request was still on the wire (same S4b bug
      // fixed in `use-posts.hooks.ts` 26fbe22c5 / `use-pages.hooks.ts` f4f2fe899).
      setRowSavingId((current) => (current === plugin.id ? null : current));
    }
  }

  async function onRemovePlugin(plugin: AdminPluginDto) {
    // Same single-flight discipline as `onToggleEnabled` — a second activation of this row's own
    // Remove (or of any other row's action) while a request is outstanding is a no-op.
    if (rowSavingId === plugin.id) return;
    setRowSavingId(plugin.id);
    setRowError(null);
    try {
      await write.mutate({ input: () => port.uninstallPlugin({ id: plugin.id }) });
      await loader.load().catch(() => {}); // The query exposes refresh failures separately from accepted writes.
    } catch (e) {
      setRowError(rules.describeApiError({ e, fallback: translate({ locale: locale, key: "failed to remove plugin" }) }, { translate: t }));
    } finally {
      // Symmetric guard to `onToggleEnabled`'s — see its comment. Keeps this correct regardless of
      // which of the two in-flight actions settles first.
      setRowSavingId((current) => (current === plugin.id ? null : current));
    }
  }
  return { onToggleEnabled, onRemovePlugin };
}

function usePluginsState(
  { port, locale, t, translate, rules }:
    Pick<Parameters<typeof usePlugins>[0], "port" | "locale" | "t" | "translate" | "rules">
) {
  const queryFetch = useCallback(async () => {
    try { return await port.listPlugins(); }
    catch (error) { throw new Error(rules.describeApiError({ e: error, fallback: translate({ locale, key: "failed to load plugins" }) }, { translate: t })); }
  }, [port, locale]);
  const key = useMemo(() => ["plugins", "list"] as const, []);
  const query = useFetchQuery({ key, fetch: queryFetch }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: queryFetch }, { staleTime: 0 });
  const plugins = query.data?.plugins ?? null;
  const canInstallFolder = query.data?.installSources?.includes("folder") === true;
  const invalidate = useInvalidate();
  const write = useFetchMutation({ run: ({ input }: { input: () => Promise<unknown> }) => input() }, { invalidates: [["plugins"]] });
  const error = query.error?.message ?? null;
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [inspectedPluginId, setInspectedPluginId] = useState<string | null>(null);
  const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    invalidate({ key: ["plugins"] });
    await loader.load().catch(() => {}); // The query exposes refresh failures separately from accepted writes.
  }, [invalidate, loader]);

  // Assistant tool results already publish through this bridge; re-read via our authorized port.
  // The query exposes the read error. No `.catch` here: `reload` already swallows its own load
  // failure, so the promise it returns never rejects (a second catch could never run).
  useContentRefreshSubscription({ resource: rules.PLUGINS_RESOURCE, onRefresh: () => { void reload(); } });
  return {
    loader, plugins, canInstallFolder, write, error, rowError, setRowError, rowSavingId, setRowSavingId, expandedIds, setExpandedIds, inspectedPluginId,
    setInspectedPluginId, settingsPluginId, setSettingsPluginId, settingsNotice, setSettingsNotice, pendingRemoveId, setPendingRemoveId, reload,
  };
}
