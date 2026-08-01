import { useEffect, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import {
  isBaseUrlInvalid,
  missingRequiredFields,
  presetRequiresApiKey,
  parseMaxTokens,
  showsBaseUrlField,
} from '@jini-ai/ui-core';
import type { ByokConfig, ConnectionTestState, ModelDiscoveryState, ProviderPreset } from '@jini-ai/ui-core';

export interface ByokProviderFormProps {
  config: ByokConfig;
  onConfigChange: (config: ByokConfig) => void;
  /** The resolved preset, or `null` when the operator is on custom/manual. */
  preset: ProviderPreset | null;
  /** Live model-discovery result. `'ok'` suggestions win over the preset's
   *  static `preferredModels`; any other status (including `'error'`) falls
   *  back to them so the field stays usable — but an `'error'` is ALSO
   *  rendered as an inline hint (see below), never silently dropped. */
  modelDiscovery: ModelDiscoveryState;
  connectionTest: ConnectionTestState;
  onTestConnection: () => void;
  /** Hides the "Test connection" control for hosts with no probe endpoint. */
  canTestConnection?: boolean;
}

/**
 * The BYOK credential card: API key, base URL, optional token cap, and model.
 * Origin: `components/byok/*` (`ByokKeyField`, `ByokProviderBaseUrl`,
 * `ByokModelField`, `ByokConnectionTestControl`) — already factored out
 * upstream, so this is assembly plus the origin's required-field marking.
 */
export function ByokProviderForm({
  config,
  onConfigChange,
  preset,
  modelDiscovery,
  connectionTest,
  onTestConnection,
  canTestConnection = true,
}: ByokProviderFormProps) {
  const t = useT();
  const [revealKey, setRevealKey] = useState(false);

  // Re-hide whenever the card switches to a different provider. `revealKey` is
  // local state and this component is not keyed by provider, so without this it
  // survives the switch: reveal provider A's key, pick provider B, and B's own
  // saved key renders as `type="text"` without anyone asking for it. The
  // credentials themselves ARE correctly per-provider (`nextConfigForPresetSelect`
  // snapshots them into `savedByProviderId`); only this disclosure toggle
  // escaped that isolation.
  useEffect(() => {
    setRevealKey(false);
  }, [config.providerId]);

  const missing = new Set(missingRequiredFields(config, preset));
  const baseUrlInvalid = isBaseUrlInvalid(config);
  const suggestions = modelDiscovery.status === 'ok' ? modelDiscovery.models : (preset?.preferredModels ?? []);
  const modelListId = 'jini-byok-model-options';

  const patch = (next: Partial<ByokConfig>) => onConfigChange({ ...config, ...next });

  return (
    <div className="jini-byok-card">
      <div className="jini-byok-card-head">
        <h4 className="jini-byok-card-title">{preset ? preset.title : t('Custom endpoint')}</h4>
      </div>

      {presetRequiresApiKey(preset) ? (
        <label className="jini-field">
          <span className="jini-field-label">
            {t('API key')}
            <span className="jini-field-required" aria-hidden="true">
              *
            </span>
            {preset?.apiKeyConsoleUrl ? (
              <a
                className="jini-field-link"
                href={preset.apiKeyConsoleUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('Get key')}
              </a>
            ) : null}
          </span>
          <span className="jini-field-input-row">
            <input
              className={'jini-input' + (missing.has('apiKey') ? ' is-missing' : '')}
              type={revealKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={config.apiKey}
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
            <button
              type="button"
              className="jini-input-affix-btn"
              aria-pressed={revealKey}
              onClick={() => setRevealKey((shown) => !shown)}
            >
              {revealKey ? t('Hide') : t('Show')}
            </button>
          </span>
          <span className="jini-field-hint">{t('Stored only by this host.')}</span>
        </label>
      ) : null}

      {showsBaseUrlField(preset) ? (
        <label className="jini-field">
          <span className="jini-field-label">
            {t('Base URL')}
            <span className="jini-field-required" aria-hidden="true">
              *
            </span>
          </span>
          <input
            className={'jini-input' + (baseUrlInvalid || missing.has('baseUrl') ? ' is-missing' : '')}
            type="url"
            inputMode="url"
            spellCheck={false}
            value={config.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
          <span className={'jini-field-hint' + (baseUrlInvalid ? ' is-error' : '')}>
            {baseUrlInvalid
              ? t('Enter an absolute http(s) URL.')
              : t('Default endpoint. Usually no need to change this.')}
          </span>
        </label>
      ) : null}

      <label className="jini-field">
        <span className="jini-field-label">{t('Max tokens (optional)')}</span>
        <input
          className="jini-input"
          type="number"
          min={1}
          step={1}
          value={config.maxTokens ?? ''}
          onChange={(event) => patch({ maxTokens: parseMaxTokens(event.target.value) })}
        />
        <span className="jini-field-hint">
          {t('Cap on the response length. Leave blank to use the model default.')}
        </span>
      </label>

      <label className="jini-field">
        <span className="jini-field-label">
          {t('Model')}
          <span className="jini-field-required" aria-hidden="true">
            *
          </span>
        </span>
        <input
          className={'jini-input' + (missing.has('model') ? ' is-missing' : '')}
          list={suggestions.length > 0 ? modelListId : undefined}
          spellCheck={false}
          value={config.model}
          onChange={(event) => patch({ model: event.target.value })}
        />
        {suggestions.length > 0 ? (
          <datalist id={modelListId}>
            {suggestions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        ) : null}
        {modelDiscovery.status === 'error' ? (
          // Non-blocking (the field above stays editable, with the preset's static
          // suggestions) but never silent — a discovery failure is an operator-actionable
          // fact (bad key, wrong base URL, unreachable endpoint), not "no models exist".
          <span className="jini-field-hint is-error" role="status">
            {t('Could not load live models: {message}', { message: modelDiscovery.message })}
          </span>
        ) : null}
      </label>

      {canTestConnection ? (
        <div className="jini-byok-test-row">
          <button
            type="button"
            className="jini-btn jini-byok-test-btn"
            disabled={connectionTest.status === 'testing' || missing.size > 0}
            onClick={onTestConnection}
          >
            {connectionTest.status === 'testing' ? t('Testing…') : t('Test connection')}
          </button>
          {connectionTest.status === 'ok' || connectionTest.status === 'error' ? (
            <span
              className={`jini-byok-test-status is-${connectionTest.status}`}
              role={connectionTest.status === 'error' ? 'alert' : 'status'}
            >
              {connectionTest.status === 'ok'
                ? (connectionTest.message ?? t('Connection succeeded'))
                : connectionTest.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
