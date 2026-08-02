import { useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { MediaProvidersPort } from '../../ports.js';
import {
  invalidBaseUrlProviderIds,
  isEntryPresent,
  isMarkerOnlyEntry,
  isProviderBaseUrlInvalid,
  maskedKeyLabel,
  resolveProviderBaseUrl,
  sortProvidersByConfigured,
} from '../../rules.js';
import type { MediaProviderMap, MediaProviderOption } from '../../types.js';
import { useMediaProvidersTab } from '../hooks/useMediaProvidersTab.js';

export interface MediaProvidersTabLabels {
  title?: string;
  description?: string;
  reloadLabel?: string;
  reloadingLabel?: string;
  unreachableLabel?: string;
  emptyStateLabel?: string;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
  showKeyLabel?: string;
  hideKeyLabel?: string;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  /** i18n template with a `{url}` placeholder. */
  baseUrlDefaultHintTemplate?: string;
  /** Shown under a base URL that is not an absolute http(s) endpoint, or that points into private address space. */
  baseUrlInvalidLabel?: string;
  modelLabel?: string;
  modelPlaceholder?: string;
  /** i18n template with a `{mask}` placeholder. Always rendered WITH a mask —
   *  see `maskedLabel`'s doc comment below for why a plain "Saved" fallback
   *  is never reachable and so has no separate label of its own. */
  savedWithMaskTemplate?: string;
  unsavedLabel?: string;
  clearLabel?: string;
  saveChangesLabel?: string;
  savingLabel?: string;
  savedNoticeLabel?: string;
  saveErrorLabel?: string;
}

export interface MediaProvidersTabProps {
  port: MediaProvidersPort;
  /** The host's own provider catalog — see `MediaProviderOption`'s doc for
   *  why this ships empty from this feature's `types.ts` rather than a
   *  baked-in vendor list. */
  catalog: readonly MediaProviderOption[];
  /** Host-persisted local edits from before this tab mounted. See
   *  `useMediaProvidersTab`'s doc for how this feeds the first-load merge. */
  initialProviders?: MediaProviderMap;
  labels?: MediaProvidersTabLabels;
}

/**
 * Per-provider credential cards: API key, base URL, and (when the catalog
 * entry advertises any) a model picker, each independently editable and
 * clearable. Origin: `MediaProvidersSection` (`SettingsDialog.tsx:7028`) minus
 * the origin's baked-in vendor catalog, "coming soon" roadmap drawer, and
 * per-vendor OAuth special case (`XaiOAuthControl`) — all product-specific
 * decorations outside this package's boundary; see `MediaProviderOption`'s
 * doc and this tab's `ports.ts` header for the full provenance note.
 */
export function MediaProvidersTab({ port, catalog, initialProviders, labels }: MediaProvidersTabProps) {
  const t = useT();
  const { providers, load, save, hasAnyConfigured, pendingProviderIds, updateProvider, clearProvider, saveChanges, reload } =
    useMediaProvidersTab({ port, initialProviders });
  const [visibleApiKeys, setVisibleApiKeys] = useState<ReadonlySet<string>>(() => new Set());

  const title = labels?.title ?? t('Media providers');
  const description = labels?.description ?? t('Credentials this host uses to generate images and video.');
  const reloadLabel = labels?.reloadLabel ?? t('Reload');
  const reloadingLabel = labels?.reloadingLabel ?? t('Reloading…');
  const unreachableLabel = labels?.unreachableLabel ?? t('Could not reach the server. Showing local changes only.');
  const emptyStateLabel = labels?.emptyStateLabel ?? t('No media providers configured yet.');
  const apiKeyLabel = labels?.apiKeyLabel ?? t('API key');
  const apiKeyPlaceholder = labels?.apiKeyPlaceholder ?? t('Paste your API key');
  const showKeyLabel = labels?.showKeyLabel ?? t('Show');
  const hideKeyLabel = labels?.hideKeyLabel ?? t('Hide');
  const baseUrlLabel = labels?.baseUrlLabel ?? t('Base URL');
  const baseUrlPlaceholder = labels?.baseUrlPlaceholder ?? t('https://api.example.com');
  const baseUrlDefaultHintTemplate = labels?.baseUrlDefaultHintTemplate ?? t('Uses {url} by default.');
  const baseUrlInvalidLabel =
    labels?.baseUrlInvalidLabel ??
    t('Enter an absolute http:// or https:// URL that is not a private or internal address.');
  const modelLabel = labels?.modelLabel ?? t('Model');
  const modelPlaceholder = labels?.modelPlaceholder ?? t('Default model');
  const savedWithMaskTemplate = labels?.savedWithMaskTemplate ?? t('Saved ({mask})');
  const unsavedLabel = labels?.unsavedLabel ?? t('Unsaved');
  const clearLabel = labels?.clearLabel ?? t('Clear');
  const saveChangesLabel = labels?.saveChangesLabel ?? t('Save changes');
  const savingLabel = labels?.savingLabel ?? t('Saving…');
  const savedNoticeLabel = labels?.savedNoticeLabel ?? t('Saved.');
  const saveErrorLabel = labels?.saveErrorLabel ?? t('Could not save media providers.');

  const toggleKeyVisible = (providerId: string) => {
    setVisibleApiKeys((current) => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const orderedCatalog = sortProvidersByConfigured(catalog, providers);
  const hasPendingChanges = pendingProviderIds.size > 0;
  // Save writes every provider at once, so ONE unacceptable endpoint blocks the
  // whole button rather than being silently persisted alongside the good ones.
  const blockedByInvalidBaseUrl = invalidBaseUrlProviderIds(providers).length > 0;

  return (
    <section className="jini-settings-section jini-settings-media-providers">
      <div className="jini-section-head">
        <div>
          <h4>{title}</h4>
          <p className="jini-hint">{description}</p>
        </div>
        <button
          type="button"
          className="jini-button jini-button-ghost"
          onClick={reload}
          disabled={load.status === 'loading'}
        >
          <Icon name="refresh" size={13} />
          <span>{load.status === 'loading' ? reloadingLabel : reloadLabel}</span>
        </button>
      </div>

      {load.status === 'unreachable' ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {unreachableLabel}
        </p>
      ) : null}

      {!hasAnyConfigured ? <p className="jini-hint">{emptyStateLabel}</p> : null}

      <div className="jini-media-provider-list">
        {orderedCatalog.map((option) => {
          const entry = providers[option.id] ?? {};
          const clearable = isEntryPresent(entry);
          const saved = isMarkerOnlyEntry(entry);
          // Guaranteed non-null: `isMarkerOnlyEntry` only holds when a server
          // marker is present, and `maskedKeyLabel` always resolves a string
          // for exactly that case — see both functions' doc comments.
          const maskedLabel = saved ? maskedKeyLabel(entry)! : null;
          const keyVisible = visibleApiKeys.has(option.id);
          const rawBaseUrl = entry.baseUrl ?? '';
          const effectiveBaseUrl = resolveProviderBaseUrl(entry, option.defaultBaseUrl);
          const baseUrlInvalid = isProviderBaseUrlInvalid(entry);
          const modelListId = `jini-media-provider-models-${option.id}`;

          return (
            <div className="jini-media-provider-card" key={option.id}>
              <div className="jini-media-provider-card-head">
                <strong>{option.label}</strong>
                {saved ? (
                  // `maskedLabel` is guaranteed non-null here — see its
                  // definition above — so no fallback is reachable to test.
                  <span className="jini-field-status-badge">{t(savedWithMaskTemplate, { mask: maskedLabel! })}</span>
                ) : null}
                {!saved && pendingProviderIds.has(option.id) ? <span className="jini-field-status-badge">{unsavedLabel}</span> : null}
              </div>

              <label className="jini-field">
                <span className="jini-field-label">{apiKeyLabel}</span>
                <span className="jini-field-input-row">
                  <input
                    className="jini-input"
                    type={keyVisible ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={saved ? maskedLabel! : apiKeyPlaceholder}
                    aria-label={`${option.label} ${apiKeyLabel}`}
                    value={entry.apiKey ?? ''}
                    onChange={(event) => updateProvider(option.id, { apiKey: event.target.value })}
                  />
                  <button
                    type="button"
                    className="jini-input-affix-btn"
                    aria-pressed={keyVisible}
                    aria-label={`${option.label} ${keyVisible ? hideKeyLabel : showKeyLabel}`}
                    onClick={() => toggleKeyVisible(option.id)}
                  >
                    <Icon name={keyVisible ? 'eye-off' : 'eye'} size={14} />
                  </button>
                </span>
              </label>

              <label className="jini-field">
                <span className="jini-field-label">{baseUrlLabel}</span>
                <input
                  className="jini-input"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder={option.defaultBaseUrl || baseUrlPlaceholder}
                  aria-label={`${option.label} ${baseUrlLabel}`}
                  value={rawBaseUrl}
                  aria-invalid={baseUrlInvalid || undefined}
                  onChange={(event) => updateProvider(option.id, { baseUrl: event.target.value })}
                />
                {baseUrlInvalid ? (
                  <span className="jini-field-hint jini-hint-error" role="alert">
                    {baseUrlInvalidLabel}
                  </span>
                ) : !rawBaseUrl.trim() && effectiveBaseUrl ? (
                  <span className="jini-field-hint">{t(baseUrlDefaultHintTemplate, { url: effectiveBaseUrl })}</span>
                ) : null}
              </label>

              <label className="jini-field">
                <span className="jini-field-label">{modelLabel}</span>
                <input
                  className="jini-input"
                  list={option.models && option.models.length > 0 ? modelListId : undefined}
                  spellCheck={false}
                  placeholder={modelPlaceholder}
                  aria-label={`${option.label} ${modelLabel}`}
                  value={entry.model ?? ''}
                  onChange={(event) => updateProvider(option.id, { model: event.target.value })}
                />
                {option.models && option.models.length > 0 ? (
                  <datalist id={modelListId}>
                    {option.models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                ) : null}
              </label>

              <button
                type="button"
                className="jini-button jini-button-ghost"
                disabled={!clearable}
                aria-label={`${option.label} ${clearLabel}`}
                onClick={() => clearProvider(option.id)}
              >
                <Icon name="trash" size={13} />
                <span>{clearLabel}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="jini-media-provider-save-row">
        <button
          type="button"
          className="jini-button"
          onClick={saveChanges}
          disabled={save.status === 'saving' || !hasPendingChanges || blockedByInvalidBaseUrl}
        >
          {save.status === 'saving' ? savingLabel : saveChangesLabel}
        </button>
        {save.status === 'saved' ? (
          <span className="jini-hint" role="status">
            {savedNoticeLabel}
          </span>
        ) : null}
        {save.status === 'save-error' ? (
          <span className="jini-hint jini-hint-error" role="alert">
            {saveErrorLabel}
          </span>
        ) : null}
      </div>
    </section>
  );
}
