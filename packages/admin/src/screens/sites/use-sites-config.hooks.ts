import { useCallback, useEffect, useState } from "react";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { SitesUserConfig, SitesUserConfigPatch } from "@jini-ai/core/contracts/site/admin-sites";
import { useInvalidate } from "../../react/kit.js";

/** The host's read and write of the local sites settings (sites home, extra folders, database placement). */
export interface SitesConfigPort {
  getSitesConfig(): Promise<SitesUserConfig>;
  setSitesConfig(patch: SitesUserConfigPatch): Promise<SitesUserConfig>;
}

/** The shape of the host's saving/error action hook (the shared panel kit's `useAsyncAction`). */
export interface SitesConfigAsyncAction {
  saving: boolean;
  error: string | null;
  run: (required: { action: () => Promise<void>; describeError: (e: unknown) => string }) => Promise<void>;
}

/** Everything `useSitesConfig` needs from the host; all REQUIRED. */
export interface SitesConfigDeps {
  port: SitesConfigPort;
  /** The host's site-list cache key, invalidated after every successful write. */
  listKey: QueryKey;
  useAsyncActionHook: () => SitesConfigAsyncAction;
}

const describeFailure = (failure: unknown): string => failure instanceof Error ? failure.message : String(failure);

/** Shared local settings effects stay here, including explicit sync-warning remedies. Saving
 * placement affects new DBs; the manual stopped-site mover applies it to existing databases.
 * Extra folders are a row list (add/remove per row, 2026-10-09 settings redesign); `roots`/`setRoots`
 * keep the one-per-line text view of the same list, and blank rows are dropped on save.
 * @complexity O(n) root strings; one API operation per action.
 */
export function useSitesConfig({ port, listKey, useAsyncActionHook }: SitesConfigDeps, _optional = {}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SitesUserConfig | null>(null);
  const [home, setHome] = useState("");
  const [rootList, setRootList] = useState<string[]>([]);
  // The row a click on "Add folder" just made, so the dialog can focus it; null otherwise.
  const [addedIndex, setAddedIndex] = useState<number | null>(null);
  const [databases, setDatabases] = useState<"inSite" | "appData">("inSite");
  const [loadError, setLoadError] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const { saving, error, run } = useAsyncActionHook();
  const accept = useCallback((next: SitesUserConfig) => {
    setConfig(next); setHome(next.sitesHome); setRootList(next.siteRoots); setAddedIndex(null); setDatabases(next.databases);
  }, []);
  useEffect(() => {
    let active = true;
    void port.getSitesConfig().then((next) => { if (active) accept(next); }).catch((failure: unknown) => {
      if (active) setLoadError(describeFailure(failure));
    });
    return () => { active = false; };
  }, [accept, port]);
  const change = useCallback((patch: SitesUserConfigPatch) => run({ action: async () => {
    accept(await port.setSitesConfig(patch)); setLoadError(null); invalidate({ key: listKey });
  }, describeError: describeFailure }), [accept, port, run, invalidate, listKey]);
  const save = useCallback(() => change({ databases,
    ...(!config?.overrides.sitesHome ? { sitesHome: home } : {}),
    ...(!config?.overrides.siteRoots ? { siteRoots: rootList.map((root) => root.trim()).filter(Boolean) } : {}),
  }), [change, config, home, rootList, databases]);
  return { open, show: () => setOpen(true), close: () => setOpen(false), config, home, setHome,
    roots: rootList.join("\n"), setRoots: ({ text }: { text: string }, _optional = {}) => setRootList(text.split("\n")),
    rootList, addedIndex,
    setRootAt: ({ index, value }: { index: number; value: string }, _optional = {}) => setRootList((list) => list.map((root, at) => at === index ? value : root)),
    addRoot: () => { setAddedIndex(rootList.length); setRootList((list) => [...list, ""]); },
    removeRoot: ({ index }: { index: number }, _optional = {}) => { setAddedIndex(null); setRootList((list) => list.filter((_, at) => at !== index)); },
    databases, setDatabases, save, saving, error: error ?? loadError,
    useAppData: () => change({ databases: "appData" }),
    useLocalHome: () => (config?.warning ? change({ sitesHome: config.warning.localHome }) : Promise.resolve()),
  };
}

/** The settings controller `useSitesConfig` returns, for a host component's `useSettings` prop. */
export type SitesConfigController = ReturnType<typeof useSitesConfig>;
