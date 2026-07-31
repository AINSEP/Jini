import { useState } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import {
  isBaseUrlInvalid,
  missingRequiredFields,
  presetRequiresApiKey,
  parseMaxTokens,
  showsBaseUrlField,
} from '../../rules.js';
import type { ByokConfig, ConnectionTestState, ProviderPreset } from '../../types.js';

export interface ByokProviderFormProps {
  config: ByokConfig;
  onConfigChange: (config: ByokConfig) => void;
  /** The resolved preset, or `null` when the operator is on custom/manual. */
  preset: ProviderPreset | null;
  /** Live-discovered model ids, when the host's port supports it. Falls back
   *  to the preset's `preferredModels`. */
  models?: readonly string[] | undefined;
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
  models,
  connectionTest,
  onTestConnection,
  canTestConnection = true,
}: ByokProviderFormProps) {
  const t = useT();
  const [revealKey, setRevealKey] = useState(false);

  const missing = new Set(missingRequiredFields(config, preset));
  const baseUrlInvalid = isBaseUrlInvalid(config);
  const suggestions = models ?? preset?.preferredModels ?? [];
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
