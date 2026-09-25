import { Fragment, useState } from 'react';
import { agentHandleProps, buildAgentListHandles } from '@jini-ai/agentic';
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
import { DEFAULT_MEDIA_PROVIDER_CATALOG } from '../../constants.js';
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
  /** The provider catalog to render. Optional — defaults to
   *  `DEFAULT_MEDIA_PROVIDER_CATALOG`; see `MediaProviderOption`'s doc for
   *  the host-override convention. */
  catalog?: readonly MediaProviderOption[];
  /** Host-persisted local edits from before this tab mounted. See
   *  `useMediaProvidersTab`'s doc for how this feeds the first-load merge. */
  initialProviders?: MediaProviderMap;
  /** Provider ids that must render first, in the order given, ahead of the
   *  usual configured/alphabetical grouping — see `sortProvidersByConfigured`'s
   *  own doc. Optional; omitted (every pre-existing caller) keeps the prior
   *  configured-first/alphabetical order unchanged. */
  pinnedProviderIds?: readonly string[];
  labels?: MediaProvidersTabLabels;
  /** This tab's own agent handle. One distinct sub-handle per provider card, derived from the
   *  provider's own catalog id via `buildAgentListHandles`. */
  agentHandle?: string;
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
export function MediaProvidersTab({
  port,
  catalog = DEFAULT_MEDIA_PROVIDER_CATALOG,
  initialProviders,
  pinnedProviderIds,
  labels,
  agentHandle,
}: MediaProvidersTabProps) {
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

  const orderedCatalog = sortProvidersByConfigured(catalog, providers, pinnedProviderIds);
  const providerHandles = agentHandle
    ? buildAgentListHandles(agentHandle, orderedCatalog.map((option) => option.id))
    : undefined;
  // Membership check against the ALREADY-ORDERED result, not `pinnedProviderIds` directly: a
  // pinned id absent from `catalog` never appears in `orderedCatalog` either (see
  // `sortProvidersByConfigured`'s own "silently skipped" doc), so this stays correct without
  // re-deriving which pinned ids actually resolved to a real card.
  const pinnedIdSet = new Set(pinnedProviderIds ?? []);
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
          {...agentHandleProps(agentHandle, { action: 'reload', role: 'button', label: reloadLabel })}
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
        {orderedCatalog.map((option, index) => {
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
          // A divider renders once, directly above the first UNpinned card — i.e. exactly at the
          // pinned/rest boundary `sortProvidersByConfigured` produced. Never renders above index 0
          // (nothing pinned, or the pinned card IS index 0 with no boundary yet) and never when
          // every card is pinned (no "rest" to separate from).
          const previousOption = index > 0 ? orderedCatalog[index - 1] : undefined;
          const showDividerBefore = !pinnedIdSet.has(option.id) && previousOption !== undefined && pinnedIdSet.has(previousOption.id);
          const providerHandle = providerHandles?.[index];

          return (
            <Fragment key={option.id}>
              {showDividerBefore ? <hr className="jini-media-provider-divider" /> : null}
              <div className="jini-media-provider-card">
              <div className="jini-media-provider-card-head">
                <strong>{option.label}</strong>
                {saved ? (
                  // `maskedLabel` is guaranteed non-null here — see its
                  // definition above — so no fallback is reachable to test.
                  <span className="jini-field-status-badge jini-field-status-badge-success">
                    {t(savedWithMaskTemplate, { mask: maskedLabel! })}
                  </span>
                ) : null}
                {!saved && pendingProviderIds.has(option.id) ? <span className="jini-field-status-badge">{unsavedLabel}</span> : null}
              </div>

              <div className="jini-media-provider-fields">
                <label className="jini-media-provider-field jini-media-provider-field--secret">
                  <span className="jini-field-label jini-sr-only">{apiKeyLabel}</span>
                  <input
                    className="jini-input"
                    type={keyVisible ? 'text' : 'password'}
                    /* `new-password`, NOT `"off"` — Chrome deliberately ignores `off` on
                       credential-shaped fields, which is how a saved password gets autofilled into
                       an API-key box. Same defect, same fix, same reasoning as
                       `ByokProviderForm`'s own API-key input; see its comment. */
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={saved ? maskedLabel! : apiKeyPlaceholder}
                    aria-label={`${option.label} ${apiKeyLabel}`}
                    value={entry.apiKey ?? ''}
                    onChange={(event) => updateProvider(option.id, { apiKey: event.target.value })}
                    {...agentHandleProps(providerHandle, { action: 'api-key', role: 'field', label: `${option.label} ${apiKeyLabel}` })}
                  />
                  <button
                    type="button"
                    className="jini-input-affix-btn"
                    aria-pressed={keyVisible}
                    aria-label={`${option.label} ${keyVisible ? hideKeyLabel : showKeyLabel}`}
                    onClick={() => toggleKeyVisible(option.id)}
                    {...agentHandleProps(providerHandle, { action: 'reveal-key', role: 'button', label: `${option.label} ${showKeyLabel}` })}
                  >
                    <Icon name={keyVisible ? 'eye-off' : 'eye'} size={14} />
                  </button>
                </label>

                <label className="jini-media-provider-field">
                  <span className="jini-field-label jini-sr-only">{baseUrlLabel}</span>
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
                    {...agentHandleProps(providerHandle, { action: 'base-url', role: 'field', label: `${option.label} ${baseUrlLabel}` })}
                  />
                </label>

                {option.models && option.models.length > 0 ? (
                  <label className="jini-media-provider-field">
                    <span className="jini-field-label jini-sr-only">{modelLabel}</span>
                    <input
                      className="jini-input"
                      list={modelListId}
                      spellCheck={false}
                      placeholder={modelPlaceholder}
                      aria-label={`${option.label} ${modelLabel}`}
                      value={entry.model ?? ''}
                      onChange={(event) => updateProvider(option.id, { model: event.target.value })}
                      {...agentHandleProps(providerHandle, { action: 'model', role: 'field', label: `${option.label} ${modelLabel}` })}
                    />
                    <datalist id={modelListId}>
                      {option.models.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </label>
                ) : null}

                <button
                  type="button"
                  className="jini-button jini-button-ghost"
                  disabled={!clearable}
                  aria-label={`${option.label} ${clearLabel}`}
                  onClick={() => clearProvider(option.id)}
                  {...agentHandleProps(providerHandle, { action: 'clear', role: 'button', label: `${option.label} ${clearLabel}` })}
                >
                  {clearLabel}
                </button>
              </div>

              {baseUrlInvalid ? (
                <span className="jini-field-hint jini-hint-error" role="alert">
                  {baseUrlInvalidLabel}
                </span>
              ) : !rawBaseUrl.trim() && effectiveBaseUrl ? (
                <span className="jini-field-hint">{t(baseUrlDefaultHintTemplate, { url: effectiveBaseUrl })}</span>
              ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="jini-media-provider-save-row">
        <button
          type="button"
          className="jini-button"
          onClick={saveChanges}
          disabled={save.status === 'saving' || !hasPendingChanges || blockedByInvalidBaseUrl}
          {...agentHandleProps(agentHandle, { action: 'save', role: 'button', label: saveChangesLabel })}
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
