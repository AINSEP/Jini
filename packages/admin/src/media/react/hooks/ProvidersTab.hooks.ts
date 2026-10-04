import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMediaProvidersTab, sortProvidersByConfigured, isEntryPresent, isMarkerOnlyEntry,
  maskedKeyLabel, isProviderBaseUrlInvalid, invalidBaseUrlProviderIds } from '@jini-ai/ui';
import type { MediaProvider, MediaProviderOption, MediaProviderConfigurationMap } from '../../models.js';
import { useMediaPorts } from './MediaPorts.hooks.js';

function configuration({ items }: { items: readonly MediaProvider[] }, _optional: Record<string, never> = {}): MediaProviderConfigurationMap {
  return Object.fromEntries(items.filter(item => item.configured || item.apiKeyTail || item.baseUrl?.trim() || item.model?.trim())
    .map(item => [item.id, { apiKeyConfigured: item.configured,
      ...(item.apiKeyTail === undefined ? {} : { apiKeyTail: item.apiKeyTail }),
      ...(item.baseUrl === undefined ? {} : { baseUrl: item.baseUrl }),
      ...(item.model === undefined ? {} : { model: item.model }) }]));
}

export function useProvidersTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { mediaProviders } = useMediaPorts();
  const [discoveredCatalog, setDiscoveredCatalog] = useState<readonly MediaProviderOption[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    return () => abort.abort();
  }, [mediaProviders]);
  // Always invoke the hook. An unavailable optional port uses an inert, scoped fallback.
  // Reuse the established editor's send-time serialization, reload merge and clear rollback.
  const editorPort = useMemo(() => {
    let lastRead: readonly MediaProvider[] = [];
    return {
      async fetchMediaProviders() {
        try {
          const signal = lifetime.current!.signal;
          const items = await mediaProviders?.list({}, { signal });
          if (!items || signal.aborted) return null;
          lastRead = items;
          setDiscoveredCatalog(items.map(({ id, label }) => ({ id, label })));
          return configuration({ items });
        } catch { return null; }
      },
      async saveMediaProviders(providers: MediaProviderConfigurationMap) {
        if (!mediaProviders) throw new Error('Provider service unavailable');
        const signal = lifetime.current!.signal;
        if (mediaProviders.saveChanges) {
          const items = await mediaProviders.saveChanges({ providers }, { signal });
          lastRead = items;
          return configuration({ items });
        }
        // Older hosts retain the one-button editor; writes remain sequential and failures
        // retain local edits. Atomic whole-set hosts should implement saveChanges instead.
        for (const item of lastRead) {
          const entry = providers[item.id];
          if (!entry) {
            if (item.configured || item.baseUrl || item.model) await mediaProviders.removeCredential({ id: item.id }, { signal });
            continue;
          }
          if ((entry.baseUrl ?? '') !== (item.baseUrl ?? '') || (entry.model ?? '') !== (item.model ?? '')) {
            if (!mediaProviders.saveSettings) throw new Error('Provider settings unavailable');
            await mediaProviders.saveSettings({ id: item.id, baseUrl: entry.baseUrl ?? '', model: entry.model ?? '' }, { signal });
          }
          if (entry.apiKey?.trim()) await mediaProviders.saveCredential({ id: item.id, credential: entry.apiKey }, { signal });
        }
        const items = await mediaProviders.list({}, { signal });
        if (!items) throw new Error('Provider service unavailable');
        lastRead = items;
        return configuration({ items });
      },
    };
  }, [mediaProviders]);
  const editor = useMediaProvidersTab({ port: editorPort });
  const catalog = mediaProviders?.catalog ?? discoveredCatalog;
  const pinnedIds = mediaProviders?.pinnedProviderIds ?? [];
  const ordered = sortProvidersByConfigured(catalog, editor.providers, pinnedIds);
  const rows = ordered.map((item, index) => {
    const entry = editor.providers[item.id] ?? {};
    const saved = isMarkerOnlyEntry(entry);
    const mask = saved ? maskedKeyLabel(entry) : null;
    const visible = visibleKeys.has(item.id);
    const invalid = isProviderBaseUrlInvalid(entry);
    const modelsId = `jini-media-provider-models-${item.id}`;
    return {
      ...item,
      divider: index > 0 && !pinnedIds.includes(item.id) && pinnedIds.includes(ordered[index - 1]!.id),
      statusLabel: saved ? `Saved (${mask})` : editor.pendingProviderIds.has(item.id) ? 'Unsaved' : null,
      statusClassName: saved ? 'jini-field-status-badge jini-field-status-badge-success' : 'jini-field-status-badge',
      credential: entry.apiKey ?? '', credentialType: visible ? 'text' as const : 'password' as const,
      credentialPlaceholder: mask ?? 'Paste your API key',
      credentialAttrs: { 'data-jini-part': 'media.provider.credential', 'data-agent-private': true,
        'data-agent-element': `media-provider-${item.id}-api-key`, 'aria-label': `${item.label} credential` },
      toggleLabel: `${item.label} ${visible ? 'Hide' : 'Show'}`, visible,
      toggle() { setVisibleKeys(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); },
      onCredential: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { apiKey: event.currentTarget.value }),
      baseUrl: entry.baseUrl ?? '', baseUrlPlaceholder: item.defaultBaseUrl || 'https://api.example.com',
      baseUrlLabel: `${item.label} base URL`,
      onBaseUrl: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { baseUrl: event.currentTarget.value }),
      model: entry.model ?? '', modelLabel: `${item.label} model`, modelsId, hasModels: !!item.models?.length,
      onModel: (event: ChangeEvent<HTMLInputElement>) => editor.updateProvider(item.id, { model: event.currentTarget.value }),
      clearLabel: `${item.label} Clear`, clearDisabled: !isEntryPresent(entry) || !mediaProviders,
      clear: () => editor.clearProvider(item.id),
      invalid, hint: invalid ? 'Enter an absolute http:// or https:// URL that is not a private or internal address.'
        : !entry.baseUrl?.trim() && item.defaultBaseUrl ? `Uses ${item.defaultBaseUrl} by default.` : null,
      hintClassName: invalid ? 'jini-field-hint jini-hint-error' : 'jini-field-hint',
      hintRole: invalid ? 'alert' as const : undefined,
      ariaInvalid: invalid || undefined,
    };
  });
  return { rows, reload: editor.reload, reloadDisabled: editor.load.status === 'loading',
    reloadLabel: editor.load.status === 'loading' ? 'Reloading…' : 'Reload',
    unreachable: editor.load.status === 'unreachable', empty: !editor.hasAnyConfigured,
    save: editor.saveChanges, saveLabel: editor.save.status === 'saving' ? 'Saving…' : 'Save changes',
    saveDisabled: !mediaProviders || editor.save.status === 'saving' || !editor.pendingProviderIds.size || !!invalidBaseUrlProviderIds(editor.providers).length,
    saved: editor.save.status === 'saved', saveError: editor.save.status === 'save-error', disabled: !mediaProviders,
    // Fail closed: a host that can persist neither the whole set nor per-provider settings
    // must not accept endpoint/model edits that would only surface as a failed save.
    settingsDisabled: !mediaProviders || (!mediaProviders.saveChanges && !mediaProviders.saveSettings) };
}
