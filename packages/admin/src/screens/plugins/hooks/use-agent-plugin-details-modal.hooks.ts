import { useCallback, useState } from "react";

import type { AgentPluginsPort } from "../../integrations/agent-plugin-ports.js";
import type { PluginRules } from "../rules.js";
import { usePluginPackageFiles, type PluginPackageFilesController } from "./use-plugin-package-files.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `AgentPluginDetailsModal`'s data: one `AGENT_PLUGIN_FILES` read for the inspected plugin,
 * mapped onto the shared viewer's rows, plus which file is selected.
 *
 * REWRITTEN 2026-09-13: this hook used to read `agent-plugin-source-catalog.ts`, a compile-time list
 * that knew only the plugins someone had hand-added — `supabase` and a site-builder plugin had no entry, so
 * their eye button opened an empty viewer. It now reads the installed package from the server and
 * delegates to the Plugins screen's own `usePluginPackageFiles`, so every installed plugin (switched
 * on or off) shows its real files, and the stale-read and selection handling exist once.
 *
 * `useX(dependencies)` / `useWiredX()` pair: a test composes {@link useAgentPluginDetailsModal} with
 * a fake agent-plugins port; the host owns the `useWiredX()` half.
 */

/** What `AgentPluginDetailsModal` renders from. `status`/`listNotice` are optional so a rendering
 *  test's fake can supply just a file list; absent reads as nothing to report. */
export type AgentPluginDetailsModalController = Pick<PluginPackageFilesController, "files" | "selectedFile" | "selectFile"> &
  Partial<Pick<PluginPackageFilesController, "status" | "listNotice">>;

export interface AgentPluginDetailsModalDependencies {
  readonly pluginId: string;
  readonly port: Pick<AgentPluginsPort, "getAgentPluginFiles">;
  readonly t: Translate;
  readonly rules: Pick<PluginRules, "describeApiError" | "packageFilesRead" | "packageFilesViewState">;
}

/**
 * Loads one installed Agent Plugin's package files once per `pluginId`.
 *
 * @complexity One GET per `pluginId`; O(files) per render (capped server-side at 200) — see
 * {@link usePluginPackageFiles}.
 */
export function useAgentPluginDetailsModal({ pluginId, port, t, rules }: AgentPluginDetailsModalDependencies): PluginPackageFilesController {
  return usePluginPackageFiles({ pluginId, queryRoot: "agent-plugins", port: { getPluginFiles: ({ id }, _optional = {}) => port.getAgentPluginFiles({ pluginId: id }) }, t, rules });
}

/** The shell owns the selected tab; its onView callback keeps host copy aligned with it. */
export function useAgentPluginDetailsView(required: { displayName: string; t: Translate; memoryT: Translate }, _optional = {}) {
  const { displayName, t, memoryT } = required;
  const [memoryOpen, setMemoryOpen] = useState(false);
  const onView = useCallback((viewId: string) => setMemoryOpen(viewId === "plugin-memory"), []);
  return {
    onView,
    title: `${displayName} ${memoryOpen ? memoryT("Memory") : t("package files")}`,
    // No subtitle on either tab: Package files' read-only note cost the phone header six lines, and
    // Memory's "Edit project notes…" line followed it out (owner, 2026-10-06).
  };
}
