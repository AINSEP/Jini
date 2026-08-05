import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { CUSTOM_MODEL_SENTINEL } from '../../constants.js';
import {
  isBaseUrlInvalid,
  missingRequiredFields,
  parseMaxTokens,
  presetRequiresApiKey,
  shouldShowCustomModelInput,
  showsBaseUrlField,
} from '../../rules.js';
import { SearchableModelSelect } from './SearchableModelSelect.js';
import type {
  ByokConfig,
  ConnectionTestState,
  ModelDiscoveryState,
  ProviderPreset,
} from '../../types.js';

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
  /**
   * Host-supplied content rendered immediately BELOW the API-key field, inside the card.
   *
   * A slot rather than a fixed control, because the thing hosts need here is host-specific: a
   * first-time key-entry screen (e.g. one gating a visitor-facing AI assistant) puts a "Test Key"
   * button plus the resulting model list directly under the key, since on that screen the key is
   * being entered for the first time and "is this key any good, and what does it allow" is the
   * question the operator has WHILE their cursor is still in that field. Answering it 4 fields
   * further down (next to "Test connection") is answering it in the wrong place.
   *
   * Deliberately a sibling of the `<label>`, not a child of it: a `<button>` inside a `<label>` makes
   * every click on the button also focus and activate the labelled input, and nesting interactive
   * controls in a label is an accessibility defect regardless of what the click does.
   *
   * Omitted by every existing caller, so the rendered output is byte-identical without it.
   */
  apiKeyFooter?: ReactNode;
  /**
   * `true` when a key is already held somewhere the browser cannot read — so the API-key input is
   * legitimately empty and must NOT be treated as a missing required field.
   *
   * Without this, a host that stores its credential server-side (write-only, never returned) gets a
   * form permanently in the "incomplete" state: the key input renders `is-missing`, and
   * "Test connection" stays disabled forever, because `missingRequiredFields` can only see what is in
   * `config`. The operator has a valid, working, stored key and a greyed-out button telling them
   * otherwise.
   *
   * Affects ONLY the emptiness check for `apiKey`. `baseUrl` and `model` are still validated normally,
   * a typed key still takes precedence, and no host without this prop changes behaviour.
   */
  apiKeyStoredExternally?: boolean;
  /**
   * Placeholder for the API-key input — for hosts holding the key somewhere the browser cannot read
   * back, so the field is genuinely empty even though a key exists.
   *
   * A host with a server-stored key can pass the server's `••••<last 4>`. That gives an operator
   * returning weeks later the one fact they need — WHICH key is in place — without the screen ever
   * holding the key itself, and without a line of prose underneath restating what the field could
   * show directly.
   *
   * Deliberately the `placeholder` attribute and never a pre-filled `value`, which is a safety
   * property rather than a style choice: a masked string living in `config.apiKey` is a real value
   * that a host's save path will happily persist AS the key, silently replacing a working credential
   * with a row of dots. A placeholder cannot be submitted, vanishes the moment real typing starts,
   * and leaves `config.apiKey` empty — which is exactly the "leave the stored key alone" signal a
   * write-only backend wants.
   */
  apiKeyPlaceholder?: string;
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
  apiKeyFooter,
  apiKeyStoredExternally = false,
  apiKeyPlaceholder,
}: ByokProviderFormProps) {
  const t = useT();
  const [revealKey, setRevealKey] = useState(false);

  /** Whether the operator explicitly picked "Custom…" in the model picker — distinct from "the
   *  saved model simply isn't in the live list". Same UI-local toggle, for the same reason, as
   *  `LocalCliAgentCard`'s: there is nowhere in `ByokConfig` for "mid-typing a custom id" to live. */
  const [explicitCustomModel, setExplicitCustomModel] = useState(false);

  // A different provider's model list is not this one's. Without this, switching from a provider
  // whose model was custom leaves the free-text box open over the new provider's real list.
  useEffect(() => {
    setExplicitCustomModel(false);
  }, [config.providerId]);

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
  // A stored-but-unreadable key satisfies the requirement. Subtracted here rather than threaded into
  // `missingRequiredFields` because that function is a pure rule over `ByokConfig` and this is a fact
  // about the HOST's storage, which does not belong in the config shape.
  if (apiKeyStoredExternally) missing.delete('apiKey');
  const baseUrlInvalid = isBaseUrlInvalid(config);
  const suggestions = modelDiscovery.status === 'ok' ? modelDiscovery.models : (preset?.preferredModels ?? []);
  const modelListId = 'jini-byok-model-options';

  /**
   * Live discovery turns the Model field from a text box into a real picker.
   *
   * The `<datalist>` below is only an autocomplete: it stays invisible until the operator types
   * into the input, so a successful discovery returning 42 models presented the operator with an
   * empty text field and no way to see any of them. The count was reported elsewhere and the list
   * itself was unreachable — a control that knows the answer and does not show it.
   *
   * Gated on `status === 'ok'` specifically, NOT on `suggestions.length`. A preset's static
   * `preferredModels` is a short ranked hint, not a catalog, and promoting it to a closed-looking
   * dropdown would imply those 2-3 entries are everything the key allows. Only a live answer from
   * the provider earns the picker; everything else keeps the text field exactly as it was.
   *
   * `SearchableModelSelect` rather than a bare `<select>`, because 42 entries is past the point
   * where scrolling a native dropdown is usable — and it is already in this package, already
   * tested, already the control `LocalCliAgentCard` uses for the same job.
   */
  const liveModels = modelDiscovery.status === 'ok' ? modelDiscovery.models : [];
  const showModelPicker = liveModels.length > 0;
  // Free-text entry survives the picker: a model id the provider did not list (a fine-tune, a new
  // release, an endpoint whose catalog lags) must still be typeable. `shouldShowCustomModelInput`
  // opens the box for an explicit "Custom…" pick AND for a value that simply isn't in the list, so
  // a hydrated or hand-typed id is never silently replaced by whatever sorts first.
  const customModelActive =
    showModelPicker && shouldShowCustomModelInput(config.model, liveModels, explicitCustomModel);

  const patch = (next: Partial<ByokConfig>) => onConfigChange({ ...config, ...next });

  return (
    <div className="jini-byok-card">
      <div className="jini-byok-card-head">
        <h4 className="jini-byok-card-title">{preset ? preset.title : t('Custom endpoint')}</h4>
      </div>

      {presetRequiresApiKey(preset) ? (
        <>
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
              placeholder={apiKeyPlaceholder}
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
        {/* No wrapper styling of its own — `.jini-byok-card` is a flex column with a 14px gap, so a
            bare sibling inherits the card's own field rhythm. A host that wants a tighter coupling to
            the field above can supply its own margin from the outside. */}
        {apiKeyFooter ? <div className="jini-byok-key-footer">{apiKeyFooter}</div> : null}
        </>
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
        {showModelPicker ? (
          <SearchableModelSelect
            className={'jini-input' + (missing.has('model') ? ' is-missing' : '')}
            ariaLabel={t('Model')}
            searchPlaceholder={t('Search models')}
            testId="jini-byok-model-select"
            searchInputTestId="jini-byok-model-search"
            value={customModelActive ? CUSTOM_MODEL_SENTINEL : config.model}
            models={liveModels.map((model) => ({ id: model, label: model }))}
            additionalOptions={[{ value: CUSTOM_MODEL_SENTINEL, label: t('Custom…') }]}
            onChange={(next) => {
              if (next === CUSTOM_MODEL_SENTINEL) {
                // Open the free-text box WITHOUT clearing `config.model`. Blanking it here would
                // discard a working model the moment someone opened the picker to look at it.
                setExplicitCustomModel(true);
                return;
              }
              setExplicitCustomModel(false);
              patch({ model: next });
            }}
          />
        ) : null}
        {/* Rendered when there is no live list at all (unchanged behaviour, `<datalist>` and all),
            and ALSO alongside the picker while custom mode is active — the second case is what
            keeps an unlisted model id typeable instead of unreachable. */}
        {!showModelPicker || customModelActive ? (
          <input
            className={'jini-input' + (missing.has('model') ? ' is-missing' : '')}
            list={!showModelPicker && suggestions.length > 0 ? modelListId : undefined}
            spellCheck={false}
            value={config.model}
            onChange={(event) => patch({ model: event.target.value })}
          />
        ) : null}
        {!showModelPicker && suggestions.length > 0 ? (
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
