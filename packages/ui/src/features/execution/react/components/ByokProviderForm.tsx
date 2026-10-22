import { useEffect, useId, useState, type ReactNode } from 'react';
import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { CUSTOM_MODEL_SENTINEL } from '../../constants.js';
import {
  apiKeyFormatWarning,
  parseMaxTokens,
  presetRequiresApiKey,
  shouldShowCustomModelInput,
  showsBaseUrlField,
} from '../../rules.js';
import { SearchableModelSelect } from './SearchableModelSelect.js';
import { useByokFieldValidation } from '../hooks/use-byok-field-validation.hooks.js';
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
  /**
   * The catalog {@link preset} was resolved from. Read for one thing only: recognising a pasted key
   * as ANOTHER row's, so `apiKeyFormatWarning` can say whose it looks like. Never used to validate
   * the selected preset's own key — see that function for why that direction is forbidden.
   *
   * Defaults to no presets. Hosts rendering this card standalone must pass their catalog
   * to enable cross-provider prefix hints, exactly as `ExecutionTab` does.
   */
  presets?: readonly ProviderPreset[];
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
   * Host-supplied content rendered at the FOOT of the card, below every field and below the
   * "Test connection" row.
   *
   * The sibling of {@link apiKeyFooter}, and separate from it for the same "put the control beside
   * what it acts on" reason. A host whose credential store is write-only has two distinct saves to
   * offer — one that writes the KEY and one that writes base URL / max tokens / model — and a single
   * control doing both cannot honestly report which of the two it just did. Splitting them needs two
   * places to put them: under the key field, and under the settings fields.
   *
   * Without this slot such a host had to hang the second control outside the card, where it reads as
   * belonging to the page rather than to the fields it writes, or fork the component.
   *
   * Omitted by every existing caller, so the rendered output is byte-identical without it.
   */
  formFooter?: ReactNode;
  /** Host actions directly below Model and its results, before any Advanced disclosure. */
  modelFooter?: ReactNode;
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
  /** This card's own agent handle — see `ExecutionTab`'s `agentHandle` doc for the split. */
  agentHandle?: string;
  /**
   * A host's button row for the key (Test key / Save key), directly UNDER the input; Show stays on
   * the input's own line (owner, 2026-10-09: the input with Show beside it, actions beneath). Given,
   * the key field renders as a `<div>` whose `<label>` wraps only the field name, so these buttons are
   * never nested inside a label (which would fold their text into the input's accessible name).
   */
  apiKeyActions?: ReactNode;
  /**
   * Moves Base URL and Max tokens into a collapsed "Advanced" disclosure after the Model row. For
   * hosts where those two are rarely touched; it opens on its own while Base URL is invalid or
   * missing, so a required-field problem is never hidden. Default `false` keeps the original order.
   */
  collapseAdvanced?: boolean;
  /** Paint required-field errors after that field loses focus; validation gates stay immediate. */
  deferMissingFeedback?: boolean;
}

/** What every field part of the card shares: the config it edits, the one-key patcher, and the
 *  validation state from `useByokFieldValidation`. */
interface ByokFieldPartProps {
  config: ByokConfig;
  patch: (next: Partial<ByokConfig>) => void;
  preset: ProviderPreset | null;
  agentHandle: string | undefined;
  validation: ReturnType<typeof useByokFieldValidation>;
}

/** `' is-missing'` when `field` is a required field the operator still has to fill. */
function missingClass(validation: ByokFieldPartProps['validation'], field: 'apiKey' | 'baseUrl' | 'model'): string {
  return validation.isMissing({ field }) ? ' is-missing' : '';
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
  presets = [],
  modelDiscovery,
  connectionTest,
  onTestConnection,
  canTestConnection = true,
  apiKeyFooter,
  formFooter,
  modelFooter,
  apiKeyStoredExternally = false,
  apiKeyPlaceholder,
  agentHandle,
  apiKeyActions,
  collapseAdvanced = false,
  deferMissingFeedback = false,
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

  const validation = useByokFieldValidation(
    { config, preset, apiKeyStoredExternally }, { deferMissingFeedback },
  );
  const patch = (next: Partial<ByokConfig>) => onConfigChange({ ...config, ...next });
  const part: ByokFieldPartProps = { config, patch, preset, agentHandle, validation };

  const connectionFields = <ByokConnectionFields {...part} />;

  return (
    <div className="jini-byok-card">
      <div className="jini-byok-card-head">
        <h4 className="jini-byok-card-title">{preset ? preset.title : t('Custom endpoint')}</h4>
      </div>

      {presetRequiresApiKey(preset) ? (
        <ByokApiKeyField
          {...part}
          presets={presets}
          revealKey={revealKey}
          onToggleReveal={() => setRevealKey((shown) => !shown)}
          apiKeyFooter={apiKeyFooter}
          apiKeyPlaceholder={apiKeyPlaceholder}
          apiKeyActions={apiKeyActions}
        />
      ) : null}

      {collapseAdvanced ? null : connectionFields}

      <ByokModelRow
        {...part}
        modelDiscovery={modelDiscovery}
        explicitCustomModel={explicitCustomModel}
        setExplicitCustomModel={setExplicitCustomModel}
        connectionTest={connectionTest}
        onTestConnection={onTestConnection}
        canTestConnection={canTestConnection}
      />

      <ByokDiscoveryError modelDiscovery={modelDiscovery} />

      <ByokConnectionResult connectionTest={connectionTest} canTestConnection={canTestConnection} />

      {/* Same bare-sibling treatment as `apiKeyFooter` above — `.jini-byok-card` is a flex column
          with a 14px gap, so this inherits the card's own rhythm rather than defining its own. */}
      <ByokSlot className="jini-byok-model-footer">{modelFooter}</ByokSlot>

      {collapseAdvanced ? <ByokAdvanced validation={validation}>{connectionFields}</ByokAdvanced> : null}

      <ByokSlot className="jini-byok-form-footer">{formFooter}</ByokSlot>
    </div>
  );
}

/** Base URL (unless the preset has a fixed origin) and Max tokens, on one wrapping row. */
function ByokConnectionFields({ config, patch, preset, agentHandle, validation }: ByokFieldPartProps) {
  const t = useT();
  return (
    <>
      {/* Base URL and Max tokens share a row (owner ruling, 2026-09-02) — neither needs the card's
          full width, and stacking them wasted a whole line on a number input. A WRAPPING flex row,
          not a two-column grid: the card is rendered at very different widths (a settings modal, a
          full admin page, a phone), and at a narrow one this has to become Base URL with Max tokens
          BELOW it rather than two squeezed columns. Source order is therefore the stacking order.
          With `showsBaseUrlField` false the row holds one child, which then fills it. */}
      <div className="jini-byok-field-row">
        {showsBaseUrlField(preset) ? (
          <label className="jini-field" onBlurCapture={() => validation.markTouched({ field: 'baseUrl' })}>
            <span className="jini-field-label">
              {t('Base URL')}
              {preset?.baseUrl ? null : <span className="jini-field-required" aria-hidden="true">
                *
              </span>}
            </span>
            <input
              className={'jini-input' + missingClass(validation, 'baseUrl')}
              type="url"
              inputMode="url"
              spellCheck={false}
              value={config.baseUrl}
              onChange={(event) => patch({ baseUrl: event.target.value })}
              {...agentHandleProps({}, { base: agentHandle, ...({ action: 'base-url', role: 'field', label: t('Base URL') }) })}
            />
            <span className={'jini-field-hint' + (validation.baseUrlInvalid ? ' is-error' : '')}>
              {validation.baseUrlInvalid
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
            {...agentHandleProps({}, { base: agentHandle, ...({ action: 'max-tokens', role: 'field', label: t('Max tokens (optional)') }) })}
          />
          <span className="jini-field-hint">
            {t('Cap on the response length. Leave blank to use the model default.')}
          </span>
        </label>
      </div>
    </>
  );
}

interface ByokApiKeyFieldProps extends ByokFieldPartProps {
  presets: readonly ProviderPreset[];
  revealKey: boolean;
  onToggleReveal: () => void;
  apiKeyFooter: ReactNode;
  apiKeyPlaceholder: string | undefined;
  apiKeyActions: ReactNode;
}

/** The API-key field (with Show/Hide, host actions and the advisory format warning) plus the
 *  host's `apiKeyFooter` slot beneath it. */
function ByokApiKeyField({
  config, patch, preset, agentHandle, validation,
  presets, revealKey, onToggleReveal, apiKeyFooter, apiKeyPlaceholder, apiKeyActions,
}: ByokApiKeyFieldProps) {
  const t = useT();
  const keyInputId = useId();
  const KeyField = apiKeyActions ? 'div' : 'label';
  /** Deliberately NOT folded into `missing` above: that set drives `is-missing` styling and the
   *  Test-connection disable, and a wrong-SHAPED key must never reach either. */
  const keyFormatWarning = apiKeyFormatWarning(config, preset, presets);
  return (
    <>
    <KeyField className="jini-field" onBlurCapture={() => validation.markTouched({ field: 'apiKey' })}>
      <span className="jini-field-label">
        <ByokApiKeyLabel keyInputId={apiKeyActions ? keyInputId : undefined} />
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
          {...(apiKeyActions ? { id: keyInputId } : {})}
          className={'jini-input' + missingClass(validation, 'apiKey')}
          type={revealKey ? 'text' : 'password'}
          /* `new-password`, NOT `"off"` — Chrome deliberately ignores `off` on credential-shaped
             fields (a long-standing intentional decision, not a bug). `off` here is what let the
             reported autofill through: Chrome filled this field with the admin's own saved
             PASSWORD, the form sent it, and the provider answered with its own "API key not
             valid" — a true message about a string the operator never typed. `new-password` is
             the value Chrome/Safari/Firefox actually honor for "this is not a saved-login
             field", which suppresses both the credential dropdown and the silent fill.

             Known trade-off, not fixed here: Chrome may now offer to GENERATE a password on
             this field — a suggestion popup, not a silently wrong value. */
          autoComplete="new-password"
          spellCheck={false}
          placeholder={apiKeyPlaceholder}
          value={config.apiKey}
          onChange={(event) => patch({ apiKey: event.target.value })}
          {...agentHandleProps({}, { base: agentHandle, ...({ action: 'api-key', role: 'field', label: t('API key') }) })}
        />
        <button
          type="button"
          className="jini-input-affix-btn"
          aria-pressed={revealKey}
          onClick={onToggleReveal}
          {...agentHandleProps({}, { base: agentHandle, ...({ action: 'reveal-key', role: 'button', label: t('Reveal API key') }) })}
        >
          {revealKey ? t('Hide') : t('Show')}
        </button>
      </span>
      {apiKeyActions ? <span className="jini-byok-key-actions">{apiKeyActions}</span> : null}
      <span className="jini-field-hint">{t('Stored only by this host.')}</span>
      {/* Advisory, never a gate: `Save`/`Test connection` stay exactly as enabled as they were,
          and the typed key is still sent verbatim. See `apiKeyFormatWarning`'s own doc for why
          a client-side format guess must not be allowed to block a credential.

          `role="status"` rather than `alert`: this is a suggestion the operator may correctly
          ignore, not a failure. It reuses the `is-error` hint styling because that is the one
          emphasised hint style this package ships and a silent-looking warning would not do the
          job — the emphasis is the point, the blocking is not. */}
      {keyFormatWarning ? (
        <span className="jini-field-hint is-error" role="status">
          {t(keyFormatWarning.message, keyFormatWarning.vars)}
        </span>
      ) : null}
    </KeyField>
    {/* No wrapper styling of its own — `.jini-byok-card` is a flex column with a 14px gap, so a
        bare sibling inherits the card's own field rhythm. A host that wants a tighter coupling to
        the field above can supply its own margin from the outside. */}
    <ByokSlot className="jini-byok-key-footer">{apiKeyFooter}</ByokSlot>
    </>
  );
}

/** "API key *". With host key actions the field is a `<div>`, so the name gets its own `<label>`
 *  pointing at the input by id; otherwise the whole field is already the label. */
function ByokApiKeyLabel({ keyInputId }: { keyInputId: string | undefined }) {
  const t = useT();
  if (keyInputId) {
    return (
      <label className="jini-field-label" htmlFor={keyInputId}>
        <span>{t('API key')}</span>
        <span className="jini-field-required" aria-hidden="true">*</span>
      </label>
    );
  }
  return (
    <>
      {t('API key')}
      <span className="jini-field-required" aria-hidden="true">
        *
      </span>
    </>
  );
}

interface ByokModelRowProps extends ByokFieldPartProps {
  modelDiscovery: ModelDiscoveryState;
  explicitCustomModel: boolean;
  setExplicitCustomModel: (custom: boolean) => void;
  connectionTest: ConnectionTestState;
  onTestConnection: () => void;
  canTestConnection: boolean;
}

/** The Model field (live picker, free-text box, or both) with "Test connection" beside it. */
function ByokModelRow({
  config, patch, preset, agentHandle, validation,
  modelDiscovery, explicitCustomModel, setExplicitCustomModel,
  connectionTest, onTestConnection, canTestConnection,
}: ByokModelRowProps) {
  const t = useT();

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
  const modelClassName = 'jini-input' + missingClass(validation, 'model');

  return (
    // "Test connection" sits BESIDE the Model control (owner ruling, 2026-09-02), not on a row of
    // its own underneath it. It probes the endpoint the Model field belongs to, and a row's
    // distance made it read as unrelated to any particular field.
    //
    // A SIBLING of the label, never a child: a `<button>` inside a `<label>` makes every click on
    // the button also focus and activate the labelled control — here, opening the model picker —
    // and nesting interactive controls in a label is an accessibility defect regardless. Same rule
    // `apiKeyFooter` documents.
    //
    // Wrapping, and `align-items: flex-end`, so the button sits on the input's own line at a
    // comfortable width and drops below the field at a narrow one. Both status lines
    // (discovery error, connection result) are deliberately OUTSIDE this row: inside it they would
    // either sit beside the button or, as label children, push it out of line the moment either
    // appeared.
    <div className="jini-byok-model-row">
      <label className="jini-field" onBlurCapture={() => validation.markTouched({ field: 'model' })}>
        <span className="jini-field-label">
          {t('Model')}
          <span className="jini-field-required" aria-hidden="true">
            *
          </span>
        </span>
        {showModelPicker ? (
          <ByokLiveModelSelect
            className={modelClassName}
            agentHandle={agentHandle}
            value={customModelActive ? CUSTOM_MODEL_SENTINEL : config.model}
            liveModels={liveModels}
            patch={patch}
            setExplicitCustomModel={setExplicitCustomModel}
          />
        ) : null}
        {/* Rendered when there is no live list at all (unchanged behaviour, `<datalist>` and all),
            and ALSO alongside the picker while custom mode is active — the second case is what
            keeps an unlisted model id typeable instead of unreachable. */}
        {!showModelPicker || customModelActive ? (
          <ByokModelTextInput
            className={modelClassName}
            value={config.model}
            patch={patch}
            agentHandle={agentHandle}
            suggestions={showModelPicker ? [] : modelSuggestions(modelDiscovery, preset)}
          />
        ) : null}
      </label>

      <ByokTestConnectionButton
        agentHandle={agentHandle}
        validation={validation}
        connectionTest={connectionTest}
        onTestConnection={onTestConnection}
        canTestConnection={canTestConnection}
      />
    </div>
  );
}

/** The probe's RESULT keeps its own full-width line. Beside the button it would have made the
 *  Model row's width depend on the length of a provider's error message. Renders nothing until
 *  the probe has finished. */
function ByokConnectionResult({ connectionTest, canTestConnection }: {
  connectionTest: ConnectionTestState;
  canTestConnection: boolean;
}) {
  const t = useT();
  if (!canTestConnection) return null;
  if (connectionTest.status !== 'ok' && connectionTest.status !== 'error') return null;
  return (
    <div className="jini-byok-test-row">
      <span
        className={`jini-byok-test-status is-${connectionTest.status}`}
        role={connectionTest.status === 'error' ? 'alert' : 'status'}
      >
        {/* Host-reported messages route through `t()` so fixed runtime sentences (e.g.
            "No API key saved. Save one to test the connection.") translate; any
            message not in the dictionary — a provider's own error text — renders verbatim. */}
        {connectionTest.status === 'ok'
          ? (connectionTest.message !== undefined ? t(connectionTest.message) : t('Connection succeeded'))
          : t(connectionTest.message)}
      </span>
    </div>
  );
}

/** Discovery failure, as an inline hint below the Model row. Renders nothing otherwise. */
function ByokDiscoveryError({ modelDiscovery }: { modelDiscovery: ModelDiscoveryState }) {
  const t = useT();
  if (modelDiscovery.status !== 'error') return null;
  return (
    // Non-blocking (the field above stays editable, with the preset's static
    // suggestions) but never silent — a discovery failure is an operator-actionable
    // fact (bad key, wrong base URL, unreachable endpoint), not "no models exist".
    //
    // Moved out of the Model `<label>` when the probe button moved up beside it: as a label
    // child it grew the field and pushed the bottom-aligned button off the input's line every
    // time discovery failed. Same element, same `.jini-field-hint.is-error[role="status"]`
    // identity host suites locate it by — only its parent changed.
    <span className="jini-field-hint is-error" role="status">
      {/* The inner message goes through `t()` too: a host-side refusal such as the runtime's
          "No API key saved. Save one to load models." is a fixed English
          sentence the shipped dictionaries carry. A provider's free-form error is not a key,
          so `t()` returns it verbatim — English output is unchanged either way. */}
      {t('Could not load live models: {message}', { message: t(modelDiscovery.message) })}
    </span>
  );
}

/** A host slot's wrapper `<div>`, rendered only when the host supplied content for it. */
function ByokSlot({ className, children }: { className: string; children: ReactNode }) {
  return children ? <div className={className}>{children}</div> : null;
}

/** The collapsed "Advanced" disclosure for Base URL and Max tokens. Opens on its own while Base URL
 *  is invalid or missing, so a required-field problem is never hidden. */
function ByokAdvanced({ validation, children }: { validation: ByokFieldPartProps['validation']; children: ReactNode }) {
  const t = useT();
  return (
    <details className="jini-byok-advanced" open={validation.baseUrlInvalid || validation.missing.has('baseUrl') || undefined}>
      <summary>{t('Advanced')}</summary>
      {children}
    </details>
  );
}

/** The live-model picker. "Custom…" opens the free-text box beside it; any real pick closes it. */
function ByokLiveModelSelect({
  className, agentHandle, value, liveModels, patch, setExplicitCustomModel,
}: {
  className: string;
  agentHandle: string | undefined;
  value: string;
  liveModels: readonly string[];
  patch: ByokFieldPartProps['patch'];
  setExplicitCustomModel: (custom: boolean) => void;
}) {
  const t = useT();
  return (
    <SearchableModelSelect
      className={className}
      ariaLabel={t('Model')}
      searchPlaceholder={t('Search models')}
      testId="jini-byok-model-select"
      searchInputTestId="jini-byok-model-search"
      {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'model' }) } : {})}
      value={value}
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
  );
}

/** "Test connection", beside the Model field. Disabled while a probe runs or a required field is
 *  blank; absent for hosts with no probe endpoint. */
function ByokTestConnectionButton({
  agentHandle, validation, connectionTest, onTestConnection, canTestConnection,
}: {
  agentHandle: string | undefined;
  validation: ByokFieldPartProps['validation'];
  connectionTest: ConnectionTestState;
  onTestConnection: () => void;
  canTestConnection: boolean;
}) {
  const t = useT();
  if (!canTestConnection) return null;
  return (
    <button
      type="button"
      className="jini-btn jini-byok-test-btn"
      disabled={connectionTest.status === 'testing' || validation.missing.size > 0}
      onClick={onTestConnection}
      {...agentHandleProps({}, { base: agentHandle, ...({ action: 'test-connection', role: 'button', label: t('Test connection') }) })}
    >
      {connectionTest.status === 'testing' ? t('Testing…') : t('Test connection')}
    </button>
  );
}

/** Autocomplete hints for the free-text Model box: the live list when discovery succeeded, else the
 *  preset's static `preferredModels`. */
function modelSuggestions(modelDiscovery: ModelDiscoveryState, preset: ProviderPreset | null): readonly string[] {
  return modelDiscovery.status === 'ok' ? modelDiscovery.models : (preset?.preferredModels ?? []);
}

/** The free-text Model box, with a `<datalist>` autocomplete when there are suggestions. */
function ByokModelTextInput({
  className, value, patch, agentHandle, suggestions,
}: {
  className: string;
  value: string;
  patch: ByokFieldPartProps['patch'];
  agentHandle: string | undefined;
  suggestions: readonly string[];
}) {
  const t = useT();
  const modelListId = 'jini-byok-model-options';
  const showDatalist = suggestions.length > 0;
  return (
    <>
      <input
        className={className}
        list={showDatalist ? modelListId : undefined}
        spellCheck={false}
        value={value}
        onChange={(event) => patch({ model: event.target.value })}
        {...agentHandleProps({}, { base: agentHandle, ...({ action: 'model', role: 'field', label: t('Model') }) })}
      />
      {showDatalist ? (
        <datalist id={modelListId}>
          {suggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
