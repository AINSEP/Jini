import type { ChangeEvent } from 'react';
import { agentHandle, agentHandleSegment } from '@jini-ai/core/agent-handles';
import { ConfirmDialog, SecretInput } from '../kit.js';
import { Segments } from './EmailSegments.js';
import type {
  EmailCopy, EmailCredentialKey, EmailKit, EmailProviderChoice, EmailProviderControl, EmailProviderField, EmailProviderView, EmailRules, EmailStatusShape, EmailTone,
} from './email-view.types.js';

/**
 * @file One provider card at a time (owner, 2026-10-22: every card stacked was too much).
 * Drafts survive URL segment changes. Save key does not switch delivery; Use this provider
 * switches both lanes after confirmation. No vendor branches: labels, fields and help links
 * all come from the provider's data. Unknown links fall back to the active, then first provider.
 * `_add-provider` lists disabled email plugins and enables them through the host's controller.
 * `_capabilities` is the final segment and shows the existing lane readiness rows.
 */

/** What every inner piece is handed explicitly: the host's components, dictionary and rules. */
type Deps<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape> = { kit: EmailKit<S>; copy: EmailCopy; rules: EmailRules<S, P, Ch> };

const LANE_STATE: Record<string, { tone: EmailTone; label: string }> = {
  ready: { tone: 'ok', label: 'Ready' },
  unconfigured: { tone: 'warning', label: 'Not set' },
  unknown_provider: { tone: 'warning', label: 'Not set' },
  missing_credential: { tone: 'warning', label: 'Key not saved' },
  local_only: { tone: 'neutral', label: 'No external delivery' },
};

const LANE_LABEL = { transactional: 'Transactional mail', bulk: 'Bulk mail' } as const;

function Lanes<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: Deps<P, Ch, S> & { status: S | null; providers: readonly P[]; locale: string }) {
  const { status, locale, kit, copy } = props;
  const lanes = status?.lanes ?? [];
  if (lanes.length === 0) return null;
  const label = props.rules.providerLabel({ locale, providers: props.providers });
  return (
    <dl className="email-facts">
      {lanes.map((lane) => {
        const state = LANE_STATE[lane.state] ?? { tone: 'neutral' as const, label: lane.state };
        return (
          <div key={lane.lane} className="email-fact">
            <dt className="jini-field-label">{copy.t({ locale, key: LANE_LABEL[lane.lane] })}</dt>
            <dd>
              <span className="jini-field-hint">{label(lane.providerId)}</span>
              <kit.Chip tone={state.tone}>{copy.t({ locale, key: state.label })}</kit.Chip>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The input type for a declared non-secret field. Pure. */
function inputType(field: EmailProviderField): string {
  return field.type === 'text' ? 'text' : field.type;
}

type CardProps<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape> = Deps<P, Ch, S> & { provider: P; controller: EmailProviderControl<P, Ch>; locale: string };

function KeyField<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: CardProps<P, Ch, S> & { field: EmailProviderField }) {
  const { provider, field, controller, locale, copy } = props;
  const key = field.key as EmailCredentialKey;
  const id = `email-provider-${provider.id}-${field.key}`;
  const secret = field.type === 'secret';
  const replacing = secret && provider.credential.saved;
  const placeholder = replacing ? copy.t({ locale, key: 'Saved — enter a new key to replace it' }) : field.placeholder ?? field.defaultValue;
  const inputProps = {
    id,
    className: 'jini-input',
    spellCheck: false,
    value: controller.drafts[provider.id]?.[key] ?? '',
    placeholder,
    onChange: (event: ChangeEvent<HTMLInputElement>) => controller.setDraftField(provider.id, key, event.target.value),
    ...agentHandle({ handle: `email-provider-${provider.id}-${agentHandleSegment({ value: field.key })}` }, { role: 'field', label: `${provider.label} ${field.label}` }),
  };
  return (
    <div className="jini-field email-field">
      <label className="jini-field-label" htmlFor={id}>{field.label}</label>
      <div className="email-input-row">
        {secret ? (
          // `new-password`, not `off`, on the key: Chrome ignores `off` and silently filled the admin
          // sign-in into these fields (the same reason as the host's access-token input).
          <SecretInput label={field.label} autoComplete="new-password" {...inputProps} />
        ) : (
          <input type={inputType(field)} autoComplete="off" {...inputProps} />
        )}
      </div>
      {field.help ? <span className="jini-field-hint">{field.help}</span> : null}
    </div>
  );
}

function ProviderChips<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>({ provider, locale, kit, copy, rules }: CardProps<P, Ch, S>) {
  const active = provider.lanes.length > 0;
  const saved = provider.credential.saved;
  return (
    <div className="email-row">
      <strong className="email-provider-name">{provider.label}</strong>
      {active ? <kit.Chip tone="ok">{copy.t({ locale, key: rules.isFullyActive({ provider }) ? 'Active' : 'Active for one lane' })}</kit.Chip> : null}
      {provider.credential.required ? <kit.Chip tone={saved ? 'ok' : 'warning'}>{copy.t({ locale, key: saved ? 'Key saved' : 'Key not saved' })}</kit.Chip> : null}
      {provider.hosted ? null : <kit.Chip tone="neutral">{copy.t({ locale, key: 'Local only' })}</kit.Chip>}
    </div>
  );
}

function ProviderKeyForm<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: CardProps<P, Ch, S>) {
  const { provider, controller, locale, copy, rules } = props;
  const fields = provider.credential.required ? provider.setup.fields : [];
  if (fields.length === 0) return null;
  const updatedAt = provider.credential.saved ? provider.credential.updatedAt : undefined;
  return (
    <form className="email-provider-form" onSubmit={(event) => { event.preventDefault(); void controller.saveKey(provider); }}>
      {updatedAt ? <span className="jini-field-hint">{copy.t({ locale, key: 'Key updated {when}' }).replace('{when}', () => rules.when({ iso: updatedAt, locale }))}</span> : null}
      {fields.map((field) => <KeyField key={field.key} {...props} field={field} />)}
      <div className="email-row">
        <button type="submit" className="btn-secondary" disabled={controller.busyId === provider.id}
          {...agentHandle({ handle: `email-provider-${provider.id}-save` }, { role: 'button', label: `Save the ${provider.label} key` })}>
          {copy.t({ locale, key: provider.credential.saved ? 'Replace key' : 'Save key' })}
        </button>
        {provider.setup.helpUrl ? <a href={provider.setup.helpUrl} target="_blank" rel="noreferrer">{copy.t({ locale, key: 'Where do I get a key?' })}</a> : null}
      </div>
    </form>
  );
}

function ProviderSwitch<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>({ provider, controller, locale, copy, rules }: CardProps<P, Ch, S>) {
  if (rules.isFullyActive({ provider })) return null;
  return (
    <>
      {/* MOVE: Credential presence is structured state; refusal text contains server internals. */}
      {provider.selectable || !provider.refusal ? null : <span className="jini-field-hint">{copy.t({ locale, key: provider.credential.required && !provider.credential.saved ? "Add this provider's key first." : 'Not set up' })}</span>}
      <div className="email-row">
        <button type="button" disabled={controller.busyId === provider.id || !provider.selectable} onClick={() => controller.askSwitch(provider)}
          {...agentHandle({ handle: `email-provider-${provider.id}-use` }, { role: 'button', label: `Send all mail with ${provider.label}` })}>
          {copy.t({ locale, key: 'Use this provider' })}
        </button>
      </div>
    </>
  );
}

function ProviderNoticeLine<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>({ provider, controller, locale, copy }: CardProps<P, Ch, S>) {
  const notice = controller.notice;
  if (notice?.providerId !== provider.id) return null;
  const error = notice.tone === 'error';
  return <p className={error ? 'jini-field-error' : 'jini-field-hint'} role={error ? 'alert' : 'status'}>{copy.t({ locale, key: notice.text })}</p>;
}

function ProviderCard<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: CardProps<P, Ch, S>) {
  return (
    <li className="email-provider" {...agentHandle({ handle: `email-provider-${props.provider.id}` }, { role: 'region', label: `Mail provider ${props.provider.label}` })}>
      <ProviderChips {...props} />
      <ProviderKeyForm {...props} />
      <ProviderSwitch {...props} />
      <ProviderNoticeLine {...props} />
    </li>
  );
}

/**
 * The card to show: `selectedId` when installed, else the provider sending all mail, else one
 * sending some, else the first. Pure. `isFullyActive` is the host's rule, passed in.
 */
export function shownProviderId<P extends Pick<EmailProviderView, 'id' | 'lanes'>>(
  { providers, selectedId, isFullyActive }: { providers: readonly P[]; selectedId: string | null | undefined; isFullyActive: (required: { provider: Pick<P, 'lanes'> }) => boolean },
  _options = {},
): string | undefined {
  const pick = providers.find((p) => p.id === selectedId) ?? providers.find((p) => isFullyActive({ provider: p })) ?? providers.find((p) => p.lanes.length > 0) ?? providers[0];
  return pick?.id;
}

/** `label` minus one trailing `(…)` group (no nested parentheses) and the whitespace around it;
 *  `label` unchanged when it does not end in one. Same result as
 *  `label.replace(/\s*\([^()]*\)\s*$/, "")`, in one linear pass. */
function withoutTrailingParenthetical({ label }: { label: string }, _options = {}): string {
  const body = label.trimEnd();
  if (!body.endsWith(')')) return label;
  const open = body.lastIndexOf('(');
  if (open === -1 || body.slice(open + 1, -1).includes(')')) return label;
  return body.slice(0, open).trimEnd();
}

/**
 * A segment's name: the provider's label without a trailing "(…)" aside — "Console (local
 * development, sends nothing)" reads as "Console"; the card keeps the full label. Pure.
 */
export function segmentLabel({ label }: { label: string }, _options = {}): string {
  return withoutTrailingParenthetical({ label }) || label;
}

export const ADD_PROVIDER_PART = '_add-provider';
export const CAPABILITIES_PART = '_capabilities';

function AddProvider<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: Deps<P, Ch, S> & { controller: EmailProviderControl<P, Ch>; locale: string; onSelect?: ((id: string) => void) | undefined }) {
  const { controller, locale, copy, rules } = props;
  const selectAdded = (id: string | undefined) => { if (id) props.onSelect?.(id); };
  return (
    <>
      {controller.addError ? <div className="email-row" role="alert">
        <span className="jini-field-error">{copy.t({ locale, key: controller.addError })}</span>
        <button type="button" className="btn-secondary" disabled={controller.adding !== null} onClick={() => void controller.retryAdd().then(selectAdded)}
          {...agentHandle({ handle: 'email-add-provider-retry' }, { role: 'button', label: 'Retry adding an email provider' })}>{copy.t({ locale, key: 'Retry' })}</button>
      </div> : null}
      {controller.choices === null && !controller.addError ? <p className="jini-field-hint" role="status">{copy.t({ locale, key: 'Loading…' })}</p> : (
        <ul className="email-list">
          {controller.choices?.map((plugin) => <li key={plugin.pluginId} className="email-row">
            <span className="email-provider-name">{rules.displayName(plugin)}</span>
            <span className="jini-field-hint">{plugin.summary ?? plugin.description}</span>
            <button type="button" disabled={controller.adding !== null} onClick={() => void controller.addProvider({ pluginId: plugin.pluginId }).then(selectAdded)}
              {...agentHandle({ handle: `email-add-provider-${plugin.pluginId}` }, { role: 'button', label: `Add ${rules.displayName(plugin)} as an email provider` })}>
              {copy.t({ locale, key: controller.adding === plugin.pluginId ? 'Adding…' : 'Add' })}
            </button>
          </li>)}
          {controller.choices?.length === 0 && !controller.addError ? <li className="jini-field-hint">{copy.t({ locale, key: 'No more email providers to add.' })}</li> : null}
        </ul>
      )}
    </>
  );
}

type CardsProps<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape> = Deps<P, Ch, S> & {
  providers: readonly P[]; controller: EmailProviderControl<P, Ch>; status: S | null; locale: string; selectedId?: string | null | undefined; onSelect?: ((id: string) => void) | undefined;
};

/** The segment to show: one of the two fixed parts when named, else a provider card, else Add provider. Pure. */
function shownPart<P extends EmailProviderView>({ providers, selectedId, isFullyActive }: { providers: readonly P[]; selectedId: string | null | undefined; isFullyActive: (required: { provider: Pick<P, 'lanes'> }) => boolean }): string {
  if (selectedId === ADD_PROVIDER_PART || selectedId === CAPABILITIES_PART) return selectedId;
  return shownProviderId({ providers, selectedId, isFullyActive }) ?? ADD_PROVIDER_PART;
}

function ProviderCards<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: CardsProps<P, Ch, S>) {
  const { providers, controller, locale, kit, copy, rules } = props;
  const deps = { kit, copy, rules };
  const shownId = shownPart({ providers, selectedId: props.selectedId, isFullyActive: rules.isFullyActive });
  const items = [...providers.map((p) => ({ key: p.id, label: segmentLabel({ label: p.label }) })),
    { key: ADD_PROVIDER_PART, label: copy.t({ locale, key: '+ Add provider' }) }, { key: CAPABILITIES_PART, label: copy.t({ locale, key: 'Capabilities' }) }];
  return (
    <>
      <Segments name="email-provider-pick" label={copy.t({ locale, key: 'Provider' })} active={shownId} onSelect={(id) => props.onSelect?.(id)} items={items} Segmented={kit.Segmented} />
      {shownId === CAPABILITIES_PART ? <Lanes {...deps} status={props.status} providers={providers} locale={locale} /> : null}
      {shownId === ADD_PROVIDER_PART ? <AddProvider {...deps} controller={controller} locale={locale} onSelect={props.onSelect} /> : null}
      <ul className="email-list email-providers">
        {providers.filter((p) => p.id === shownId).map((provider) => <ProviderCard key={provider.id} {...deps} provider={provider} controller={controller} locale={locale} />)}
      </ul>
    </>
  );
}

export interface EmailProviderTabProps<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape> {
  readonly controller: EmailProviderControl<P, Ch>; readonly status: S | null; readonly locale: string;
  readonly selectedId?: string | null | undefined; readonly onSelect?: ((id: string) => void) | undefined;
  readonly kit: EmailKit<S>; readonly copy: EmailCopy; readonly rules: EmailRules<S, P, Ch>;
}

/** The Provider tab: one provider card per segment, Add provider, Capabilities, and the switch confirmation. */
export function EmailProviderTab<P extends EmailProviderView, Ch extends EmailProviderChoice, S extends EmailStatusShape>(props: EmailProviderTabProps<P, Ch, S>) {
  const { controller, locale, kit, copy, rules } = props;
  const pending = controller.pendingSwitch;
  return (
    <kit.Section id="provider" title={copy.t({ locale, key: 'Provider' })} hideTitle>
      {controller.addWarning ? <p className="jini-field-hint" role="status">{controller.addWarning}</p> : null}
      <kit.Loaded view={controller.view} locale={locale} retry={controller.reload}>
        {(report) => (
          <>
            <ProviderCards kit={kit} copy={copy} rules={rules} providers={report.providers} controller={controller} status={props.status} locale={locale} selectedId={props.selectedId} onSelect={props.onSelect} />
            {report.refusals.length > 0 ? (
              <>
                <h3 className="jini-field-label email-subhead">{copy.t({ locale, key: 'Not loaded' })}</h3>
                <ul className="email-list">
                  {report.refusals.map((reason) => <li key={reason} className="jini-field-hint">{reason}</li>)}
                </ul>
              </>
            ) : null}
          </>
        )}
      </kit.Loaded>
      <ConfirmDialog
        open={pending !== null}
        agentHandle="email-provider-switch"
        title={copy.t({ locale, key: 'Switch email provider?' })}
        body={<p>{copy.t({ locale, key: 'All email — sign-in links, confirmations, notifications and newsletters — will send with {provider}.' }).replace('{provider}', () => pending?.label ?? '')}</p>}
        confirmLabel={copy.t({ locale, key: 'Switch' })}
        pending={pending !== null && controller.busyId === pending.id}
        onConfirm={() => void controller.confirmSwitch()}
        onCancel={() => controller.askSwitch(null)}
      />
    </kit.Section>
  );
}
