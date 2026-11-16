/**
 * @file Test-only fake of the admin kit's media-providers editor slot. It implements
 * `AdminMediaProvidersKit` against the port the editor is given, with the observable duties of a
 * host's editor (read on mount, pending edits survive a reload, one save flushes the set, clear
 * persists at once) and none of its race handling — tests of that live with the real editor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminMediaProvidersKit, MediaProviderCredentials, MediaProviderMap, MediaProvidersLoadState,
  MediaProvidersSaveState, UseMediaProvidersTabOptions, UseMediaProvidersTabResult,
} from './kit-media-providers.js';

const MASK_TAIL = 4;

const isEntryPresent = (entry: MediaProviderCredentials | null | undefined): boolean =>
  !!entry && !!(entry.apiKey?.trim() || entry.baseUrl?.trim() || entry.model?.trim() || entry.apiKeyConfigured || entry.apiKeyTail);

const isMarkerOnlyEntry = (entry: MediaProviderCredentials | null | undefined): boolean =>
  !!entry && !entry.apiKey?.trim() && !!(entry.apiKeyConfigured || entry.apiKeyTail);

function maskedKeyLabel(entry: MediaProviderCredentials | null | undefined): string | null {
  const tail = entry?.apiKeyTail?.trim() || entry?.apiKey?.trim();
  if (tail) return `••••${tail.slice(-MASK_TAIL)}`;
  return entry?.apiKeyConfigured ? '••••' : null;
}

function isProviderBaseUrlInvalid(entry: MediaProviderCredentials | null | undefined): boolean {
  const typed = entry?.baseUrl?.trim();
  if (!typed) return false;
  try { return !['http:', 'https:'].includes(new URL(typed).protocol); } catch { return true; }
}

const invalidBaseUrlProviderIds = (providers: MediaProviderMap | null | undefined): readonly string[] =>
  Object.keys(providers ?? {}).filter((id) => isProviderBaseUrlInvalid(providers?.[id]));

function sortProvidersByConfigured<T extends { id: string; label: string }>(
  catalog: readonly T[], providers: MediaProviderMap | null | undefined, pinnedIds: readonly string[] = [],
): readonly T[] {
  const pinned = pinnedIds.flatMap((id) => catalog.filter((item) => item.id === id));
  const rest = catalog.filter((item) => !pinnedIds.includes(item.id)).sort((a, b) => {
    const configured = Number(isEntryPresent(providers?.[b.id])) - Number(isEntryPresent(providers?.[a.id]));
    return configured || a.label.localeCompare(b.label);
  });
  return [...pinned, ...rest];
}

/** Daemon answer over local state; ids with a pending edit keep their local fields. */
function reconcile({ local, daemon, pending }: { local: MediaProviderMap; daemon: MediaProviderMap; pending: ReadonlySet<string> }, _optional: Record<string, never> = {}): MediaProviderMap {
  const merged: MediaProviderMap = {};
  for (const [id, entry] of Object.entries(daemon)) merged[id] = pending.has(id) ? { ...entry, ...local[id] } : entry;
  for (const id of pending) if (local[id] && !merged[id]) merged[id] = local[id];
  return merged;
}

function useEditorState(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const [providers, setProviders] = useState<MediaProviderMap>({});
  const [load, setLoad] = useState<MediaProvidersLoadState>({ status: 'loading' });
  const [save, setSave] = useState<MediaProvidersSaveState>({ status: 'idle' });
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const live = useRef({ providers, pending });
  live.current = { providers, pending };
  return { providers, setProviders, load, setLoad, save, setSave, pending, setPending, live };
}

function useFakeMediaProvidersTab({ port }: UseMediaProvidersTabOptions, _optional: Record<string, never> = {}): UseMediaProvidersTabResult {
  const s = useEditorState();
  const { setProviders, setLoad, setSave, setPending, live } = s;
  const reload = useCallback(() => {
    setLoad({ status: 'loading' });
    void port.fetchMediaProviders().then((daemon) => {
      if (daemon) setProviders((local) => reconcile({ local, daemon, pending: live.current.pending }));
      setLoad({ status: daemon ? 'ok' : 'unreachable' });
    });
  }, [port, setLoad, setProviders, live]);
  useEffect(() => { reload(); }, [reload]);
  const persist = useCallback((next: MediaProviderMap) => {
    setSave({ status: 'saving' });
    return port.saveMediaProviders(next).then(
      (saved) => { setProviders(saved); setPending(new Set()); setSave({ status: 'saved' }); },
      (error: unknown) => setSave({ status: 'save-error', message: error instanceof Error ? error.message : 'save failed' }),
    );
  }, [port, setProviders, setPending, setSave]);
  const updateProvider = useCallback<UseMediaProvidersTabResult['updateProvider']>((id, patch) => {
    setProviders((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setPending((current) => new Set(current).add(id));
    setSave({ status: 'idle' });
  }, [setProviders, setPending, setSave]);
  const clearProvider = useCallback((id: string) => {
    const { [id]: _dropped, ...rest } = live.current.providers;
    setProviders(rest);
    void persist(rest);
  }, [persist, setProviders, live]);
  const saveChanges = useCallback(() => { void persist(live.current.providers); }, [persist, live]);
  return {
    providers: s.providers, load: s.load, save: s.save, pendingProviderIds: s.pending,
    hasAnyConfigured: Object.values(s.providers).some(isEntryPresent),
    updateProvider, clearProvider, saveChanges, reload,
  };
}

export const fakeMediaProviders: AdminMediaProvidersKit = {
  useMediaProvidersTab: useFakeMediaProvidersTab,
  rules: { sortProvidersByConfigured, isEntryPresent, isMarkerOnlyEntry, maskedKeyLabel, isProviderBaseUrlInvalid, invalidBaseUrlProviderIds },
};
