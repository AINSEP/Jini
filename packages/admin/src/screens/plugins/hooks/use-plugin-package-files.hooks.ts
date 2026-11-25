import { useCallback, useState } from "react";

import { useFetchQuery } from "../../../react/kit.js";
import type { PackageFilesListing, PackageFilesRead, PackageFilesStatus, PackageFileView, PluginRules } from "../rules.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `PluginPackageFilesModal`'s data: one `PLUGIN_FILES` read for the inspected plugin, mapped
 * onto the shared `PackageFilesModal`'s row shape, plus which file is selected. The Agent Plugins
 * viewer (`use-agent-plugin-details-modal.hooks.ts`) reuses this same hook over `AGENT_PLUGIN_FILES`
 * (2026-09-13), so both screens share one stale-read and selection implementation.
 *
 * `useX(dependencies)` / `useWiredX()` pair, same as `use-plugins.hooks.ts`: a test composes
 * {@link usePluginPackageFiles} with a fake port. The host owns the `useWiredX()` half (its request,
 * locale and dictionary), so this file carries none of them.
 */

export interface PluginPackageFilesDependencies {
  readonly pluginId: string;
  /** CMS and agent packages have different endpoints even when their identifiers match. */
  readonly queryRoot?: "plugins" | "agent-plugins";
  /** Any read that yields a listing — `PluginsPort.getPluginFiles`, or an adapter over
   *  `AgentPluginsPort.getAgentPluginFiles`. */
  readonly port: { getPluginFiles(required: { id: string }, optional?: Record<string, never>): Promise<PackageFilesListing> };
  readonly t: Translate;
  /** The host's bound rule functions: its error describer and the listing-to-rows mapping. */
  readonly rules: Pick<PluginRules, "describeApiError" | "packageFilesRead" | "packageFilesViewState">;
}

export interface PluginPackageFilesController {
  /** `[]` until the listing settles, and after a failed load. */
  files: readonly PackageFileView[];
  /** The selected file, else the first listed one; `null` only while `files` is empty. */
  selectedFile: PackageFileView | null;
  /** Selects by `relativePath`. An unknown path falls back to the tree's top file rather than clearing. */
  selectFile: (relativePath: string) => void;
  /** Loading, failure (`role: "alert"`), or an empty package — `null` once there are files. */
  status: PackageFilesStatus | null;
  /** Set when the server's caps left some files out. */
  listNotice: string | null;
  /** Bound translator — the modal's only source of copy. */
  t: Translate;
}

/**
 * Loads one plugin's package files once per `pluginId`.
 *
 * A read that settles after `pluginId` changed (or after unmount) is dropped by the effect's cleanup
 * flag, and a stored read for a different id is never rendered — so a slow response for the
 * previously inspected plugin can never show under the current one's title. Mapping the read onto
 * rows, selection, and status is `rules.ts`'s `packageFilesViewState`.
 *
 * @complexity One GET per `pluginId`; O(files) per render to map rows (capped server-side at 200).
 */
export function usePluginPackageFiles({ pluginId, port, t, rules, queryRoot = "plugins" }: PluginPackageFilesDependencies): PluginPackageFilesController {
  const [selectedPath, setSelectedPath] = useState("");
  const queryFetch = useCallback(async () => {
    try { return await port.getPluginFiles({ id: pluginId }); }
    catch (error) { throw new Error(rules.describeApiError({ e: error, fallback: t("failed to load package files") })); }
  }, [port, pluginId]);
  const query = useFetchQuery({ key: [queryRoot, "files", pluginId], fetch: queryFetch }, { staleTime: 0 });
  const read: PackageFilesRead | null = rules.packageFilesRead(query);
  return { ...rules.packageFilesViewState({ read, selectedPath, translate: t }), selectFile: setSelectedPath, t };
}
