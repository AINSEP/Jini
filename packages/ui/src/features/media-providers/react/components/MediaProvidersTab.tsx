import { canonicalMediaProviderId } from '@jini-ai/integrations/media-providers/catalog';
import { useState } from 'react';
import { agentHandleProps, buildAgentListHandles } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { MediaProvidersPort } from '../../ports.js';
import { invalidBaseUrlProviderIds, sortProvidersByConfigured } from '../../rules.js';
import { DEFAULT_MEDIA_PROVIDER_CATALOG } from '../../constants.js';
import type { MediaProviderMap, MediaProviderOption, MediaProvidersSaveState } from '../../types.js';
import { useMediaProvidersTab } from '../hooks/useMediaProvidersTab.js';
import { MediaProviderCard } from './MediaProviderCard.js';
import { resolveMediaProvidersTabLabels, type ResolvedMediaProvidersTabLabels } from './media-providers-tab-labels.js';

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
  const resolved = resolveMediaProvidersTabLabels({ t }, { labels });

  const toggleKeyVisible = (providerId: string) => {
    setVisibleApiKeys((current) => toggledMember({ set: current, member: providerId }));
  };

  const canonicalPinnedIds = pinnedProviderIds?.map((id) => canonicalMediaProviderId({ id }));
  const orderedCatalog = sortProvidersByConfigured(catalog.map((entry) => ({ ...entry, id: canonicalMediaProviderId({ id: entry.id }) })), providers, canonicalPinnedIds);
  const providerHandles = agentHandle
    ? buildAgentListHandles({ prefix: agentHandle, ids: orderedCatalog.map((option) => option.id) })
    : undefined;
  // Membership check against the ALREADY-ORDERED result, not `pinnedProviderIds` directly: a
  // pinned id absent from `catalog` never appears in `orderedCatalog` either (see
  // `sortProvidersByConfigured`'s own "silently skipped" doc), so this stays correct without
  // re-deriving which pinned ids actually resolved to a real card.
  const pinnedIdSet = new Set(canonicalPinnedIds ?? []);
  const hasPendingChanges = pendingProviderIds.size > 0;
  // Save writes every provider at once, so ONE unacceptable endpoint blocks the
  // whole button rather than being silently persisted alongside the good ones.
  const blockedByInvalidBaseUrl = invalidBaseUrlProviderIds(providers).length > 0;

  return (
    <section className="jini-settings-section jini-settings-media-providers">
      <TabHead labels={resolved} loading={load.status === 'loading'} onReload={reload} agentHandle={agentHandle} />

      {load.status === 'unreachable' ? (
        <p className="jini-hint jini-hint-error" role="alert">
          {resolved.unreachableLabel}
        </p>
      ) : null}

      {!hasAnyConfigured ? <p className="jini-hint">{resolved.emptyStateLabel}</p> : null}

      <div className="jini-media-provider-list">
        {orderedCatalog.map((option, index) => (
          <MediaProviderCard
            key={option.id}
            option={option}
            entry={providers[option.id] ?? {}}
            labels={resolved}
            t={t}
            pending={pendingProviderIds.has(option.id)}
            keyVisible={visibleApiKeys.has(option.id)}
            showDividerBefore={isDividerBefore({ option, previousOption: orderedCatalog[index - 1], pinnedIdSet })}
            providerHandle={providerHandles?.[index]}
            onUpdate={(patch) => updateProvider(option.id, patch)}
            onClear={() => clearProvider(option.id)}
            onToggleKeyVisible={() => toggleKeyVisible(option.id)}
          />
        ))}
      </div>

      <SaveRow
        labels={resolved}
        save={save}
        disabled={!hasPendingChanges || blockedByInvalidBaseUrl}
        onSave={saveChanges}
        agentHandle={agentHandle}
      />
    </section>
  );
}

/** A copy of `set` with `member` added if absent, removed if present. */
function toggledMember({ set, member }: { set: ReadonlySet<string>; member: string }): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(member)) {
    next.delete(member);
  } else {
    next.add(member);
  }
  return next;
}

/**
 * A divider renders once, directly above the first UNpinned card — i.e. exactly at the
 * pinned/rest boundary `sortProvidersByConfigured` produced. Never renders above index 0
 * (nothing pinned, or the pinned card IS index 0 with no boundary yet) and never when
 * every card is pinned (no "rest" to separate from).
 */
function isDividerBefore({
  option,
  previousOption,
  pinnedIdSet,
}: {
  option: MediaProviderOption;
  /** `undefined` for index 0. */
  previousOption: MediaProviderOption | undefined;
  pinnedIdSet: ReadonlySet<string>;
}): boolean {
  return !pinnedIdSet.has(option.id) && previousOption !== undefined && pinnedIdSet.has(previousOption.id);
}

function TabHead({
  labels,
  loading,
  onReload,
  agentHandle,
}: {
  labels: ResolvedMediaProvidersTabLabels;
  loading: boolean;
  onReload: () => void;
  agentHandle: string | undefined;
}) {
  return (
    <div className="jini-section-head">
      <div>
        <h4>{labels.title}</h4>
        <p className="jini-hint">{labels.description}</p>
      </div>
      <button
        type="button"
        className="jini-button jini-button-ghost"
        onClick={onReload}
        disabled={loading}
        {...agentHandleProps({}, { base: agentHandle, ...({ action: 'reload', role: 'button', label: labels.reloadLabel }) })}
      >
        <Icon name="refresh" size={13} />
        <span>{loading ? labels.reloadingLabel : labels.reloadLabel}</span>
      </button>
    </div>
  );
}

function SaveRow({
  labels,
  save,
  disabled,
  onSave,
  agentHandle,
}: {
  labels: ResolvedMediaProvidersTabLabels;
  save: MediaProvidersSaveState;
  disabled: boolean;
  onSave: () => void;
  agentHandle: string | undefined;
}) {
  const saving = save.status === 'saving';
  return (
    <div className="jini-media-provider-save-row">
      <button
        type="button"
        className="jini-button"
        onClick={onSave}
        disabled={saving || disabled}
        {...agentHandleProps({}, { base: agentHandle, ...({ action: 'save', role: 'button', label: labels.saveChangesLabel }) })}
      >
        {saving ? labels.savingLabel : labels.saveChangesLabel}
      </button>
      {save.status === 'saved' ? (
        <span className="jini-hint" role="status">
          {labels.savedNoticeLabel}
        </span>
      ) : null}
      {save.status === 'save-error' ? (
        <span className="jini-hint jini-hint-error" role="alert">
          {labels.saveErrorLabel}
        </span>
      ) : null}
    </div>
  );
}
