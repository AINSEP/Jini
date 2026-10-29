import { useFetchMutation } from '@jini-ai/ui/fetch-query';
import { MEDIA_QUERY_KEYS, useMediaProvidersQuery } from './MediaQuery.hooks.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMediaProvidersTab, sortProvidersByConfigured, isEntryPresent, isMarkerOnlyEntry,
  maskedKeyLabel, isProviderBaseUrlInvalid, invalidBaseUrlProviderIds } from '@jini-ai/ui';
import type { MediaProvider, MediaProviderOption, MediaProviderConfigurationMap } from '../../models.js';
import { useMediaPorts } from './MediaPorts.hooks.js';
import type { MediaProvidersPort } from '../../ports.js';
import type { MediaProviderCatalogPolicy } from '@jini-ai/core';

/** Host adapters supply canonical IDs (media/PORT.md); keep them literal in the editor.
 * Pure operations preserve values and copy maps in O(n) time/space; ID lookup is O(1). */
const catalogPolicy: MediaProviderCatalogPolicy = {
  canonicalMediaProviderId: ({ id }, _options = {}) => id,
  normalizeMediaProviderMap: ({ providers }, _options = {}) => ({ ...providers }),
};

function configuration({ items }: { items: readonly MediaProvider[] }, _optional: Record<string, never> = {}): MediaProviderConfigurationMap {
  return Object.fromEntries(items.filter(item => item.configured || item.apiKeyTail || item.baseUrl?.trim() || item.model?.trim())
    .map(item => [item.id, { apiKeyConfigured: item.configured,
      ...(item.apiKeyTail === undefined ? {} : { apiKeyTail: item.apiKeyTail }),
      ...(item.baseUrl === undefined ? {} : { baseUrl: item.baseUrl }),
      ...(item.model === undefined ? {} : { model: item.model }) }]));
}

type ProviderEntry = MediaProviderConfigurationMap[string];
type ProvidersEditor = ReturnType<typeof useMediaProvidersTab>;
/** Drops a cleared provider's stored state; one that never held any needs no call. */
async function removeIfStored({ port, item, signal }: { port: MediaProvidersPort; item: MediaProvider; signal: AbortSignal }, _optional: Record<string, never> = {}) {
  if (item.configured || item.baseUrl || item.model) await port.removeCredential({ id: item.id }, { signal });
}
/** Absent endpoint and model compare and send as blank, the stored "use the default". */
function settingsOf({ source }: { source: { readonly baseUrl?: string | undefined; readonly model?: string | undefined } }, _optional: Record<string, never> = {}) {
  return { baseUrl: source.baseUrl ?? '', model: source.model ?? '' };
}
async function saveProviderSettings(
  { port, item, entry, signal }: { port: MediaProvidersPort; item: MediaProvider; entry: ProviderEntry; signal: AbortSignal },
  _optional: Record<string, never> = {},
) {
  const next = settingsOf({ source: entry }), stored = settingsOf({ source: item });
  if (next.baseUrl === stored.baseUrl && next.model === stored.model) return;
  if (!port.saveSettings) throw new Error('Provider settings unavailable');
  await port.saveSettings({ id: item.id, ...next }, { signal });
}
async function saveProvider(
  { port, item, signal }: { port: MediaProvidersPort; item: MediaProvider; signal: AbortSignal },
  { entry }: { entry?: ProviderEntry | undefined } = {},
) {
  if (!entry) {
    await removeIfStored({ port, item, signal });
    return;
  }
  await saveProviderSettings({ port, item, entry, signal });
  if (entry.apiKey?.trim()) await port.saveCredential({ id: item.id, credential: entry.apiKey }, { signal });
}
async function saveSequentially(
  { port, providers, lastRead, signal }: { port: MediaProvidersPort; providers: MediaProviderConfigurationMap; lastRead: readonly MediaProvider[]; signal: AbortSignal },
  _optional: Record<string, never> = {},
) {
  // Older hosts retain the one-button editor; writes remain sequential and failures
  // retain local edits. Atomic whole-set hosts should implement saveChanges instead.
  // Submitted ids the last read never returned (catalog-only providers getting their
  // first key or settings) start from an empty stored state, or their writes are lost.
  const known = new Set(lastRead.map(item => item.id));
  const unread = Object.keys(providers).filter(id => !known.has(id)).map(id => ({ id, configured: false }) as MediaProvider);
  for (const item of [...lastRead, ...unread]) await saveProvider({ port, item, signal }, { entry: providers[item.id] });
  const items = await port.list({}, { signal });
  if (!items) throw new Error('Provider service unavailable');
  return items;
}
function rowStatus({ entry, pending }: { entry: ProviderEntry; pending: boolean }, _optional: Record<string, never> = {}) {
  const saved = isMarkerOnlyEntry(entry);
  const mask = saved ? maskedKeyLabel(entry) : null;
  const unsavedLabel = pending ? 'Unsaved' : null;
  return {
    mask,
    statusLabel: saved ? `Saved (${mask})` : unsavedLabel,
    statusClassName: saved ? 'jini-field-status-badge jini-field-status-badge-success' : 'jini-field-status-badge',
  };
}
/** Names the provider default an empty endpoint falls back to, when it has one. */
function defaultBaseUrlHint({ entry, item }: { entry: ProviderEntry; item: MediaProviderOption }) {
  return !entry.baseUrl?.trim() && item.defaultBaseUrl ? `Uses ${item.defaultBaseUrl} by default.` : null;
}
function baseUrlHint({ entry, item }: { entry: ProviderEntry; item: MediaProviderOption }, _optional: Record<string, never> = {}) {
  const invalid = isProviderBaseUrlInvalid(entry);
  return {
    invalid, hint: invalid ? 'Enter an absolute http:// or https:// URL that is not a private or internal address.' : defaultBaseUrlHint({ entry, item }),
    hintClassName: invalid ? 'jini-field-hint jini-hint-error' : 'jini-field-hint',
    hintRole: invalid ? 'alert' as const : undefined,
    ariaInvalid: invalid || undefined,
  };
}
function credentialFields(
  { item, entry, editor, visible }: { item: MediaProviderOption; entry: ProviderEntry; editor: ProvidersEditor; visible: boolean },
  { mask = null }: { mask?: string | null } = {},
) {
  return {
    credential: entry.apiKey ?? '', credentialType: visible ? 'text' as const : 'password' as const,
    credentialPlaceholder: mask ?? 'Paste your API key',
    credentialAttrs: { 'data-jini-part': 'media.provider.credential', 'data-agent-private': true,
      'data-agent-element': `media-provider-${item.id}-api-key`, 'aria-label': `${item.label} credential` },
    toggleLabel: `${item.label} ${visible ? 'Hide' : 'Show'}`, visible,
    onCredential: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { apiKey: event.currentTarget.value }),
  };
}
function settingsFields({ item, entry, editor }: { item: MediaProviderOption; entry: ProviderEntry; editor: ProvidersEditor }, _optional: Record<string, never> = {}) {
  return {
    baseUrl: entry.baseUrl ?? '', baseUrlPlaceholder: item.defaultBaseUrl || 'https://api.example.com',
    baseUrlLabel: `${item.label} base URL`,
    onBaseUrl: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { baseUrl: event.currentTarget.value }),
    model: entry.model ?? '', modelLabel: `${item.label} model`, modelsId: `jini-media-provider-models-${item.id}`, hasModels: !!item.models?.length,
    onModel: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { model: event.currentTarget.value }),
  };
}
function providerRow(
  { item, entry, editor, visible, toggle }: {
    item: MediaProviderOption; entry: ProviderEntry; editor: ProvidersEditor; visible: boolean; toggle: () => void;
  },
  { divider = false, disabled = false }: { divider?: boolean; disabled?: boolean } = {},
) {
  const { mask, ...status } = rowStatus({ entry, pending: editor.pendingProviderIds.has(item.id) });
  return {
    ...item,
    divider,
    ...status,
    ...credentialFields({ item, entry, editor, visible }, { mask }),
    toggle,
    ...settingsFields({ item, entry, editor }),
    clearLabel: `${item.label} Clear`, clearDisabled: !isEntryPresent(entry) || disabled,
    clear: () => editor.clearProvider(item.id),
    ...baseUrlHint({ entry, item }),
  };
}
function editorView({ editor, port }: { editor: ProvidersEditor; port: MediaProvidersPort | undefined }, _optional: Record<string, never> = {}) {
  const loading = editor.load.status === 'loading', saving = editor.save.status === 'saving';
  return { reload: editor.reload, reloadDisabled: loading,
    reloadLabel: loading ? 'Reloading…' : 'Reload',
    unreachable: editor.load.status === 'unreachable', empty: !editor.hasAnyConfigured,
    save: editor.saveChanges, saveLabel: saving ? 'Saving…' : 'Save changes',
    saveDisabled: !port || saving || !editor.pendingProviderIds.size || !!invalidBaseUrlProviderIds(editor.providers).length,
    saved: editor.save.status === 'saved', saveError: editor.save.status === 'save-error', disabled: !port,
    // Fail closed: a host that can persist neither the whole set nor per-provider settings
    // must not accept endpoint/model edits that would only surface as a failed save.
    settingsDisabled: !port || (!port.saveChanges && !port.saveSettings) };
}
export function useProvidersTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { mediaProviders } = useMediaPorts();
  const cached = useMediaProvidersQuery({ port: mediaProviders });
  const reads = useRef(cached.loader); reads.current = cached.loader;
  const [discoveredCatalog, setDiscoveredCatalog] = useState<readonly MediaProviderOption[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    return () => abort.abort();
  }, [mediaProviders]);
  // Always invoke the hook. An unavailable optional port uses an inert, scoped fallback.
  // Reuse the established editor's send-time serialization, reload merge and clear rollback.
  const rawEditorPort = useMemo(() => {
    let lastRead: readonly MediaProvider[] = [];
    return {
      async fetchMediaProviders() {
        try {
          const signal = lifetime.current!.signal;
          const items = await reads.current.load();
          if (!items || signal.aborted) return null;
          lastRead = items;
          setDiscoveredCatalog(items.map(({ id, label }) => ({ id, label })));
          return configuration({ items });
        } catch { return null; }
      },
      async saveMediaProviders(providers: MediaProviderConfigurationMap) {
        if (!mediaProviders) throw new Error('Provider service unavailable');
        const signal = lifetime.current!.signal;
        const items = mediaProviders.saveChanges
          ? await mediaProviders.saveChanges({ providers }, { signal })
          : await saveSequentially({ port: mediaProviders, providers, lastRead, signal });
        lastRead = items;
        return configuration({ items });
      },
    };
  }, [mediaProviders]);
  const save = useFetchMutation({ run: ({ input }: { input: MediaProviderConfigurationMap }) => rawEditorPort.saveMediaProviders(input) },
    { invalidates: [MEDIA_QUERY_KEYS.providers] });
  const saves = useRef(save); saves.current = save;
  const editorPort = useMemo(() => ({
    fetchMediaProviders: async () => {
      // staleTime: 0 on the loader forces a new settled read on explicit reload, while the
      // initial editor read joins the observer's in-flight request instead of cancelling it.
      return rawEditorPort.fetchMediaProviders();
    },
    saveMediaProviders: (providers: MediaProviderConfigurationMap) => saves.current.mutate({ input: providers }),
  }), [rawEditorPort]);
  const editor = useMediaProvidersTab({ port: editorPort, catalogPolicy });
  const catalog = mediaProviders?.catalog ?? discoveredCatalog;
  const pinnedIds = mediaProviders?.pinnedProviderIds ?? [];
  const ordered = sortProvidersByConfigured(catalog, editor.providers, pinnedIds);
  const toggleKey = (id: string) => setVisibleKeys(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id);
    return next; });
  const rows = ordered.map((item, index) => providerRow(
    { item, entry: editor.providers[item.id] ?? {}, editor, visible: visibleKeys.has(item.id), toggle: () => toggleKey(item.id) },
    { divider: index > 0 && !pinnedIds.includes(item.id) && pinnedIds.includes(ordered[index - 1]!.id), disabled: !mediaProviders },
  ));
  return { rows, ...editorView({ editor, port: mediaProviders }) };
}
