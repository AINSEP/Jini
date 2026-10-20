import { Fragment } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import type { I18nContextValue } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import {
  isEntryPresent,
  isMarkerOnlyEntry,
  isProviderBaseUrlInvalid,
  maskedKeyLabel,
  resolveProviderBaseUrl,
} from '../../rules.js';
import type { MediaProviderCredentials, MediaProviderOption } from '../../types.js';
import type { MediaProviderEditPatch } from '../hooks/useMediaProvidersTab.js';
import type { ResolvedMediaProvidersTabLabels } from './media-providers-tab-labels.js';

type Translate = I18nContextValue['t'];

/** What every field of one card shares. */
interface CardFieldContext {
  option: MediaProviderOption;
  entry: MediaProviderCredentials;
  labels: ResolvedMediaProvidersTabLabels;
  providerHandle: string | undefined;
  onUpdate: (patch: MediaProviderEditPatch) => void;
}

export interface MediaProviderCardProps {
  option: MediaProviderOption;
  entry: MediaProviderCredentials;
  labels: ResolvedMediaProvidersTabLabels;
  t: Translate;
  pending: boolean;
  keyVisible: boolean;
  showDividerBefore: boolean;
  providerHandle: string | undefined;
  onUpdate: (patch: MediaProviderEditPatch) => void;
  onClear: () => void;
  onToggleKeyVisible: () => void;
}

/** One provider's credential card: API key, base URL, optional model, clear, and the base-URL hint. */
export function MediaProviderCard(props: MediaProviderCardProps) {
  const { option, entry, labels, t, providerHandle, onUpdate } = props;
  const saved = isMarkerOnlyEntry(entry);
  // Guaranteed non-null: `isMarkerOnlyEntry` only holds when a server
  // marker is present, and `maskedKeyLabel` always resolves a string
  // for exactly that case — see both functions' doc comments.
  const maskedLabel = saved ? maskedKeyLabel(entry)! : null;
  const fields: CardFieldContext = { option, entry, labels, providerHandle, onUpdate };

  return (
    <Fragment>
      {props.showDividerBefore ? <hr className="jini-media-provider-divider" /> : null}
      <div className="jini-media-provider-card">
      <CardHead option={option} labels={labels} t={t} maskedLabel={maskedLabel} pending={props.pending} />

      <div className="jini-media-provider-fields">
        <ApiKeyField {...fields} maskedLabel={maskedLabel} keyVisible={props.keyVisible} onToggleKeyVisible={props.onToggleKeyVisible} />
        <BaseUrlField {...fields} />
        {option.models && option.models.length > 0 ? <ModelField {...fields} models={option.models} /> : null}

        <button
          type="button"
          className="jini-button jini-button-ghost"
          disabled={!isEntryPresent(entry)}
          aria-label={`${option.label} ${labels.clearLabel}`}
          onClick={props.onClear}
          {...agentHandleProps({}, { base: providerHandle, ...({ action: 'clear', role: 'button', label: `${option.label} ${labels.clearLabel}` }) })}
        >
          {labels.clearLabel}
        </button>
      </div>

      <BaseUrlHint entry={entry} option={option} labels={labels} t={t} />
      </div>
    </Fragment>
  );
}

function CardHead({
  option,
  labels,
  t,
  maskedLabel,
  pending,
}: {
  option: MediaProviderOption;
  labels: ResolvedMediaProvidersTabLabels;
  t: Translate;
  maskedLabel: string | null;
  pending: boolean;
}) {
  // `maskedLabel` is non-null exactly when the entry is marker-only ("saved").
  const saved = maskedLabel !== null;
  return (
    <div className="jini-media-provider-card-head">
      <strong>{option.label}</strong>
      {saved ? (
        // `maskedLabel` is guaranteed non-null here — see its
        // definition above — so no fallback is reachable to test.
        <span className="jini-field-status-badge jini-field-status-badge-success">
          {t(labels.savedWithMaskTemplate, { mask: maskedLabel })}
        </span>
      ) : null}
      {!saved && pending ? <span className="jini-field-status-badge">{labels.unsavedLabel}</span> : null}
    </div>
  );
}

function ApiKeyField({
  option,
  entry,
  labels,
  providerHandle,
  onUpdate,
  maskedLabel,
  keyVisible,
  onToggleKeyVisible,
}: CardFieldContext & { maskedLabel: string | null; keyVisible: boolean; onToggleKeyVisible: () => void }) {
  return (
    <label className="jini-media-provider-field jini-media-provider-field--secret">
      <span className="jini-field-label jini-sr-only">{labels.apiKeyLabel}</span>
      <input
        className="jini-input"
        type={keyVisible ? 'text' : 'password'}
        /* `new-password`, NOT `"off"` — Chrome deliberately ignores `off` on
           credential-shaped fields, which is how a saved password gets autofilled into
           an API-key box. Same defect, same fix, same reasoning as
           `ByokProviderForm`'s own API-key input; see its comment. */
        autoComplete="new-password"
        spellCheck={false}
        placeholder={maskedLabel ?? labels.apiKeyPlaceholder}
        aria-label={`${option.label} ${labels.apiKeyLabel}`}
        value={entry.apiKey ?? ''}
        onChange={(event) => onUpdate({ apiKey: event.target.value })}
        {...agentHandleProps({}, { base: providerHandle, ...({ action: 'api-key', role: 'field', label: `${option.label} ${labels.apiKeyLabel}` }) })}
      />
      <button
        type="button"
        className="jini-input-affix-btn"
        aria-pressed={keyVisible}
        aria-label={`${option.label} ${keyVisible ? labels.hideKeyLabel : labels.showKeyLabel}`}
        onClick={onToggleKeyVisible}
        {...agentHandleProps({}, { base: providerHandle, ...({ action: 'reveal-key', role: 'button', label: `${option.label} ${labels.showKeyLabel}` }) })}
      >
        <Icon name={keyVisible ? 'eye-off' : 'eye'} size={14} />
      </button>
    </label>
  );
}

function BaseUrlField({ option, entry, labels, providerHandle, onUpdate }: CardFieldContext) {
  return (
    <label className="jini-media-provider-field">
      <span className="jini-field-label jini-sr-only">{labels.baseUrlLabel}</span>
      <input
        className="jini-input"
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder={option.defaultBaseUrl || labels.baseUrlPlaceholder}
        aria-label={`${option.label} ${labels.baseUrlLabel}`}
        value={entry.baseUrl ?? ''}
        aria-invalid={isProviderBaseUrlInvalid(entry) || undefined}
        onChange={(event) => onUpdate({ baseUrl: event.target.value })}
        {...agentHandleProps({}, { base: providerHandle, ...({ action: 'base-url', role: 'field', label: `${option.label} ${labels.baseUrlLabel}` }) })}
      />
    </label>
  );
}

function ModelField({ option, entry, labels, providerHandle, onUpdate, models }: CardFieldContext & { models: readonly string[] }) {
  const modelListId = `jini-media-provider-models-${option.id}`;
  return (
    <label className="jini-media-provider-field">
      <span className="jini-field-label jini-sr-only">{labels.modelLabel}</span>
      <input
        className="jini-input"
        list={modelListId}
        spellCheck={false}
        placeholder={labels.modelPlaceholder}
        aria-label={`${option.label} ${labels.modelLabel}`}
        value={entry.model ?? ''}
        onChange={(event) => onUpdate({ model: event.target.value })}
        {...agentHandleProps({}, { base: providerHandle, ...({ action: 'model', role: 'field', label: `${option.label} ${labels.modelLabel}` }) })}
      />
      <datalist id={modelListId}>
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </label>
  );
}

/** The invalid-URL alert, else the "uses X by default" hint while the field is blank, else nothing. */
function BaseUrlHint({
  entry,
  option,
  labels,
  t,
}: {
  entry: MediaProviderCredentials;
  option: MediaProviderOption;
  labels: ResolvedMediaProvidersTabLabels;
  t: Translate;
}) {
  if (isProviderBaseUrlInvalid(entry)) {
    return (
      <span className="jini-field-hint jini-hint-error" role="alert">
        {labels.baseUrlInvalidLabel}
      </span>
    );
  }
  const effectiveBaseUrl = resolveProviderBaseUrl(entry, option.defaultBaseUrl);
  if ((entry.baseUrl ?? '').trim() || !effectiveBaseUrl) return null;
  return <span className="jini-field-hint">{t(labels.baseUrlDefaultHintTemplate, { url: effectiveBaseUrl })}</span>;
}
