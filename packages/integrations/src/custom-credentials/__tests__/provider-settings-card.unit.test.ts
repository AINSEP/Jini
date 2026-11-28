/**
 * @file The provider-settings key card through its exported behaviour: the form built from a provider
 * plugin's declared fields, the submitted-values reader, and the `credential_save` handler wired to
 * injected ports and secret-card engine. Nothing here inspects the field helpers' internals.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SurfaceCardApp } from '@jini-ai/core/contracts/cards';
import type { PluginProviderSettingField } from '@jini-ai/core/contracts/plugin-sdk';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { CustomCredentialSecretCards } from '../../credentialed-http/tools/credential-tool-host.js';
import {
  buildProviderSettingsCredentialHandler,
  buildProviderSettingsForm,
  readProviderSettingsValues,
  type ProviderSettingsCardIdentity,
  type ProviderSettingsCardPorts,
} from '../provider-settings-card.js';

type Prep = Parameters<typeof buildProviderSettingsForm>[0]['prep'];
const app = { name: 'form-app' } as unknown as SurfaceCardApp;
const outcomeApp = { name: 'outcome-app' } as unknown as SurfaceCardApp;
const field = (f: Partial<PluginProviderSettingField> & { name: string; label: string }) => f as PluginProviderSettingField;
const prepOf = (over: Partial<Prep> = {}): Prep => ({ pluginId: 'mailer', fields: [], saved: null, ...over });
const form = (over: Partial<Prep>) => buildProviderSettingsForm({ prep: prepOf(over), app });

describe('buildProviderSettingsForm: public text fields', () => {
  it('shows the declared default, hint and requirement when nothing is saved', () => {
    expect(form({ fields: [field({ name: 'region', label: 'Region', required: true, hint: 'Where it runs', default: 'us' })] }).fields).toEqual([
      { kind: 'string', name: 'region', label: 'Region', required: true, hint: 'Where it runs', value: 'us' },
    ]);
  });

  it('prefers the saved value over the default, but a saved empty string falls back to the default', () => {
    const fields = [field({ name: 'region', label: 'Region', default: 'us' })];
    expect(form({ fields, saved: { settings: { region: 'eu' }, secretNames: [] } }).fields[0]).toMatchObject({ value: 'eu', required: false });
    expect(form({ fields, saved: { settings: { region: '' }, secretNames: [] } }).fields[0]).toMatchObject({ value: 'us' });
  });

  it('omits value and hint when neither exists, and carries conditional requirements through', () => {
    const [control] = form({ fields: [field({ name: 'sender', label: 'Sender', requiredWhen: { field: 'mode', equals: 'send' }, requiredUnless: { field: 'dry' } } as never)] }).fields;
    expect(control).toEqual({ kind: 'string', name: 'sender', label: 'Sender', required: false,
      requiredUnless: { field: 'dry' }, requiredWhen: { field: 'mode', equals: 'send' } });
  });
});

describe('buildProviderSettingsForm: fields with choices', () => {
  const options = [{ value: 'smtp', label: 'SMTP' }, { value: 'api', label: 'API' }];

  it('renders one select with the declared options and the saved choice, else the default', () => {
    const fields = [field({ name: 'transport', label: 'Transport', required: true, options, default: 'api' })];
    expect(form({ fields }).fields).toEqual([{ kind: 'enum', name: 'transport', label: 'Transport', required: true, options, value: 'api' }]);
    expect(form({ fields, saved: { settings: { transport: 'smtp' }, secretNames: [] } }).fields).toEqual([
      { kind: 'enum', name: 'transport', label: 'Transport', required: true, options, value: 'smtp' }]);
  });

  it('leaves the select unselected when there is neither a saved value nor a default', () => {
    const [select] = form({ fields: [field({ name: 'transport', label: 'Transport', options })] }).fields;
    expect('value' in select!).toBe(false);
  });

  it('adds a "Custom…" option and a text twin when custom values are allowed, with the twin empty for a listed value', () => {
    const fields = [field({ name: 'transport', label: 'Transport', options, allowCustom: true, hint: 'Pick or type' })];
    const controls = form({ fields, saved: { settings: { transport: 'api' }, secretNames: [] } }).fields;
    expect(controls).toEqual([
      { kind: 'enum', name: 'transport', label: 'Transport', required: false, options: [...options, { value: '__custom', label: 'Custom…' }], value: 'api' },
      { kind: 'string', name: 'transport__custom', label: 'Custom transport', hint: 'Pick or type' },
    ]);
  });

  it('selects "Custom…" and prefills the twin when the saved value is not one of the options', () => {
    const fields = [field({ name: 'transport', label: 'Transport', options, allowCustom: true })];
    const [select, twin] = form({ fields, saved: { settings: { transport: 'sendmail' }, secretNames: [] } }).fields;
    expect(select).toMatchObject({ kind: 'enum', value: '__custom' });
    expect(twin).toEqual({ kind: 'string', name: 'transport__custom', label: 'Custom transport', value: 'sendmail' });
  });

  it('keeps an unlisted saved value as the selection, with no twin, when custom values are not allowed', () => {
    const controls = form({ fields: [field({ name: 'transport', label: 'Transport', options })], saved: { settings: { transport: 'legacy' }, secretNames: [] } }).fields;
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ kind: 'enum', value: 'legacy' });
  });

  it('carries conditional requirements onto the select', () => {
    const [select] = form({ fields: [field({ name: 'transport', label: 'T', options, requiredWhen: { field: 'mode', equals: 'x' } } as never)] }).fields;
    expect(select).toMatchObject({ requiredWhen: { field: 'mode', equals: 'x' } });
  });
});

describe('buildProviderSettingsForm: secret fields', () => {
  it('requires a never-saved required secret and carries no value of any kind', () => {
    const [control] = form({ fields: [field({ name: 'apiKey', label: 'API key', secret: true, required: true })], saved: { settings: { apiKey: 'sk-leak' }, secretNames: [] } }).fields;
    expect(control).toEqual({ kind: 'string', name: 'apiKey', label: 'API key', secret: true, required: true, allowBlank: false });
    expect(JSON.stringify(control)).not.toContain('sk-leak');
  });

  it('marks a saved secret as kept: blank allowed, saved flag set, and the keep hint appended to the declared hint', () => {
    const [control] = form({ fields: [field({ name: 'apiKey', label: 'API key', secret: true, required: true, hint: 'Find it in the dashboard.' })], saved: { settings: {}, secretNames: ['apiKey'] } }).fields;
    expect(control).toEqual({ kind: 'string', name: 'apiKey', label: 'API key', secret: true, required: true, hasSavedValue: true, allowBlank: true,
      hint: 'Find it in the dashboard. Leave blank to keep the saved one.' });
  });

  it('allows blank for an optional secret and for a conditionally required one, leaving the decision to the shared save rule', () => {
    const fields = [
      field({ name: 'optional', label: 'Optional', secret: true }),
      field({ name: 'conditional', label: 'Conditional', secret: true, required: true, requiredUnless: { field: 'other' } } as never),
    ];
    const [optional, conditional] = form({ fields }).fields;
    expect(optional).toMatchObject({ required: false, allowBlank: true });
    expect(conditional).toMatchObject({ required: true, allowBlank: true, requiredUnless: { field: 'other' } });
  });
});

describe('buildProviderSettingsForm: secret fields required by a public choice', () => {
  it('carries requiredWhen onto a required secret and allows its blank, leaving the decision to the shared save rule', () => {
    const [control] = form({ fields: [field({ name: 'smtpPassword', label: 'SMTP password', secret: true, required: true, requiredWhen: { field: 'transport', equals: 'smtp' } } as never)] }).fields;
    expect(control).toEqual({ kind: 'string', name: 'smtpPassword', label: 'SMTP password', secret: true, required: true,
      requiredWhen: { field: 'transport', equals: 'smtp' }, allowBlank: true });
  });
});

describe('buildProviderSettingsForm: card copy', () => {
  it('uses neutral fallbacks when the provider declares no card', () => {
    const result = form({});
    expect(result).toMatchObject({ title: 'Connect provider', submitLabel: 'Save', details: [], app });
    expect(result.description).toBe('Keys are sealed on the server the moment you submit — the assistant never sees them.');
  });

  it('takes title, intro, help, key hint and purposes from the declared card, joining purposes with "; "', () => {
    const result = form({ card: { title: 'Connect Mailer', intro: 'Send mail from forms.', helpUrl: 'https://help.test/keys', helpLabel: 'Get a key', keyHint: 'Dashboard, API tab', usedFor: ['forms', 'newsletter'] } as never });
    expect(result.title).toBe('Connect Mailer');
    expect(result.description).toBe('Send mail from forms. Keys are sealed on the server the moment you submit — the assistant never sees them.');
    expect(result.details).toEqual([
      { label: 'Get a key', value: 'https://help.test/keys' }, { label: 'Where to find it', value: 'Dashboard, API tab' }, { label: 'Used for', value: 'forms; newsletter' },
    ]);
  });

  it('labels an unlabelled help link "Help" and skips empty purposes', () => {
    expect(form({ card: { helpUrl: 'https://help.test' } as never }).details).toEqual([{ label: 'Help', value: 'https://help.test' }]);
    expect(form({ card: { usedFor: [] } as never }).details).toEqual([]);
  });

  it('warns that a key entered here is site-only when the project key is used by other sites, and only then', () => {
    const card = { label: 'Mailer' } as never;
    const notice = (usage: unknown) => form({ card, usage: usage as never }).description;
    expect(notice({ store: 'project', usedByThisSite: false, usedBy: ['Blog', 'Shop'] })).toContain(" Your project's saved Mailer key is used by Blog, Shop. A key entered here is used by this site only.");
    for (const quiet of [undefined, { store: 'site', usedByThisSite: false, usedBy: ['Blog'] }, { store: 'project', usedByThisSite: true, usedBy: ['Blog'] }, { store: 'project', usedByThisSite: false, usedBy: [] }]) {
      expect(notice(quiet), JSON.stringify(quiet)).not.toContain('used by this site only');
    }
    expect(form({ usage: { store: 'project', usedByThisSite: false, usedBy: ['Blog'] } as never }).description).toContain('saved provider key');
  });
});

describe('readProviderSettingsValues', () => {
  const fields = [field({ name: 'region', label: 'Region' }), field({ name: 'transport', label: 'Transport', options: [{ value: 'a', label: 'A' }], allowCustom: true }), field({ name: 'apiKey', label: 'Key', secret: true })];

  it('keeps declared string values, ignores undeclared and non-string ones', () => {
    expect(readProviderSettingsValues({ fields, values: { region: 'eu', apiKey: 'sk-1', stray: 'x', transport: 7 } })).toEqual({ region: 'eu', apiKey: 'sk-1' });
  });

  it('takes the text twin\'s value when "Custom…" was chosen, and drops the choice when the twin is missing', () => {
    expect(readProviderSettingsValues({ fields, values: { transport: '__custom', transport__custom: 'sendmail' } })).toEqual({ transport: 'sendmail' });
    expect(readProviderSettingsValues({ fields, values: { transport: '__custom' } })).toEqual({});
    expect(readProviderSettingsValues({ fields, values: { transport: 'a', transport__custom: 'ignored' } })).toEqual({ transport: 'a' });
  });
});

describe('buildProviderSettingsCredentialHandler', () => {
  const identity: ProviderSettingsCardIdentity = { toolId: 'credential_save', uriNamespace: 'host-ns', formApp: app, outcomeApp };
  const ctxFor = (input: unknown) => ({ input, principal: { id: 'p1' } }) as unknown as ToolExecutionContext;

  function wire(overrides: Partial<ProviderSettingsCardPorts> = {}, cardsLoaded: unknown[] = []) {
    const seen: { config?: any; options?: any; engine?: any; ctx?: unknown; opts?: unknown } = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const askThenReport = Symbol('askThenReport');
    const cards = {
      askThenReport,
      defineSecretCardTool: (config: unknown, options: unknown) => {
        seen.config = config; seen.options = options;
        return { handler: (engine: unknown) => (ctx: unknown, opts: unknown) => { seen.engine = engine; seen.ctx = ctx; seen.opts = opts; return 'engine-result'; } };
      },
    } as unknown as CustomCredentialSecretCards;
    const ports = {
      authorize: vi.fn(async () => {}),
      fields: vi.fn(async () => [field({ name: 'apiKey', label: 'Key', secret: true }), field({ name: 'region', label: 'Region' })]),
      readSettings: vi.fn(async () => ({ settings: { region: 'eu' }, secretNames: ['apiKey'] })),
      save: vi.fn(async () => ({ store: 'site' as const, configured: true, appliesAt: 'now' as const })),
      ...overrides,
    } as unknown as ProviderSettingsCardPorts;
    const surfaces = { surfaceExchanges: { marker: 'exchanges' } } as never;
    const handler = buildProviderSettingsCredentialHandler({ ports, surfaces, loadCards: async () => cardsLoaded as never, cards, identity });
    return { handler, seen, ports, askThenReport };
  }

  it('rejects a call with no pluginId before defining any card', async () => {
    const { handler, seen, ports } = wire();
    await expect(handler(ctxFor({}))).rejects.toMatchObject({ name: 'ToolInputError' });
    expect(seen.config).toBeUndefined();
    expect(ports.authorize).not.toHaveBeenCalled();
  });

  it('defines the card under the host identity and runs it with the host\'s exchange store and ask-then-report', async () => {
    const { handler, seen, askThenReport } = wire();
    const ctx = ctxFor({ pluginId: 'mailer' });
    expect(await handler(ctx, { marker: 'opts' } as never)).toBe('engine-result');
    expect(seen.config.toolId).toBe('credential_save');
    expect(seen.options).toMatchObject({ uriHost: 'host-ns', frameSize: ['100%', '460px'] });
    expect(seen.engine).toEqual({ surfaceExchanges: { marker: 'exchanges' }, askThenReport });
    expect(seen.ctx).toBe(ctx);
    expect(seen.opts).toEqual({ marker: 'opts' });
  });

  it('prepare: authorizes first, then loads fields, usage, saved settings and the matching provider-settings card', async () => {
    const usage = vi.fn(async () => ({ store: 'project', usedByThisSite: false, usedBy: ['Blog'] }));
    const declared = { saveKind: 'provider-settings', saveTarget: 'mailer', title: 'Connect Mailer' };
    const { handler, seen, ports } = wire({ usage } as never, [
      { saveKind: 'provider-settings', saveTarget: 'other-plugin', title: 'Wrong target' },
      { saveKind: 'custom', saveTarget: 'mailer', title: 'Wrong kind' },
      declared,
    ]);
    const ctx = ctxFor({ pluginId: 'mailer' });
    await handler(ctx);
    const prep = await seen.config.prepare();
    expect(ports.authorize).toHaveBeenCalledWith(ctx);
    expect(usage).toHaveBeenCalledWith({ pluginId: 'mailer' });
    expect(prep).toMatchObject({ pluginId: 'mailer', card: declared, saved: { settings: { region: 'eu' }, secretNames: ['apiKey'] }, usage: { usedBy: ['Blog'] } });
    expect(prep.fields.map((f: PluginProviderSettingField) => f.name)).toEqual(['apiKey', 'region']);
    expect(seen.config.form({ prep }).title).toBe('Connect Mailer');
    expect(seen.config.form({ prep }).app).toBe(app);
  });

  it('prepare: denies before reading anything when authorization throws', async () => {
    const denied = new Error('forbidden');
    const { handler, seen, ports } = wire({ authorize: vi.fn(async () => { throw denied; }) });
    await handler(ctxFor({ pluginId: 'mailer' }));
    await expect(seen.config.prepare()).rejects.toBe(denied);
    expect(ports.fields).not.toHaveBeenCalled();
    expect(ports.readSettings).not.toHaveBeenCalled();
  });

  it('prepare: tells the model to install the provider first when it declares no settings, and omits card/usage when absent', async () => {
    const missing = wire({ fields: vi.fn(async () => undefined) });
    await missing.handler(ctxFor({ pluginId: 'ghost' }));
    await expect(missing.seen.config.prepare()).rejects.toMatchObject({ name: 'ToolInputError', message: expect.stringContaining("The provider plugin 'ghost' is not installed or declares no settings.") });

    const bare = wire();
    await bare.handler(ctxFor({ pluginId: 'mailer' }));
    const prep = await bare.seen.config.prepare();
    expect('card' in prep).toBe(false);
    expect(prep.usage).toBeUndefined();
  });

  it('save: submits only declared values (Custom… resolved) to the shared rule and returns what it saved', async () => {
    const { handler, seen, ports } = wire();
    await handler(ctxFor({ pluginId: 'mailer' }));
    const prep = await seen.config.prepare();
    const saved = await seen.config.save({ values: { apiKey: 'sk-new', region: 'us', undeclared: 'x' }, prep });
    expect(ports.save).toHaveBeenCalledWith({ pluginId: 'mailer', values: { apiKey: 'sk-new', region: 'us' } });
    expect(saved).toEqual({ store: 'site', configured: true, appliesAt: 'now' });
  });

  it('save: a refusal from the shared rule is thrown, and only its own text survives safeError', async () => {
    const { handler, seen } = wire({ save: vi.fn(async () => ({ refusal: 'Region is required.' })) } as never);
    await handler(ctxFor({ pluginId: 'mailer' }));
    const prep = await seen.config.prepare();
    const thrown = await seen.config.save({ values: {}, prep }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(seen.options.safeError(thrown)).toBe('Region is required.');
    expect(seen.options.safeError(new Error('ECONNRESET sk-leak'))).toBe('Saving failed. Nothing was saved.');
    expect(seen.options.safeError('opaque')).toBe('Saving failed. Nothing was saved.');
  });

  describe('result and outcome projections', () => {
    const run = async () => { const w = wire(); await w.handler(ctxFor({ pluginId: 'mailer' })); return w.seen.config; };

    it('result: saved defaults appliesAt to "restart" and keeps the engine\'s own value when present', async () => {
      const config = await run();
      expect(config.result({ run: { status: 'saved', saved: { store: 'project', configured: false } } })).toEqual({ saved: true, pluginId: 'mailer', store: 'project', configured: false, appliesAt: 'restart' });
      expect(config.result({ run: { status: 'saved', saved: { store: 'site', appliesAt: 'now' } } })).toMatchObject({ saved: true, appliesAt: 'now' });
    });

    it('result: failed, blank and any other status are model-facing refusals that never carry values', async () => {
      const config = await run();
      expect(config.result({ run: { status: 'failed', safeMessage: 'Saving failed. Nothing was saved.' } })).toEqual({ saved: false, reason: 'error', message: 'Saving failed. Nothing was saved.' });
      expect(config.result({ run: { status: 'blank' } })).toEqual({ saved: false, reason: 'invalid', message: 'A required key was left blank. Nothing was saved.' });
      expect(config.result({ run: { status: 'cancelled' } })).toEqual({ saved: false, reason: 'cancelled' });
    });

    it.each([
      ['site store, not configured', { store: 'site' }, 'Saved for this site.', 'success'],
      ['site store, configured, applied now', { store: 'site', configured: true, appliesAt: 'now' }, 'Saved for this site. Now sending.', 'success'],
      ['site store, configured, needs restart', { store: 'site', configured: true }, 'Saved for this site. Reload open pages or restart this site to finish applying the saved settings.', 'success'],
      ['project store used by sites', { store: 'project', usedBy: ['Blog', 'Shop'] }, 'Saved. Used by Blog, Shop. Other sites pick it up within 30 seconds.', 'success'],
      ['project store used by none', { store: 'project', usedBy: [] }, 'Saved to your project — not used by any site yet.', 'success'],
      ['saved but the provider failed to start', { store: 'site', configured: true, appliesAt: 'failed' }, 'Saved, but the provider could not start. Check the plugin settings and save again.', 'failure'],
      ['saved but failed to start, with the engine\'s message', { store: 'site', appliesAt: 'failed', message: 'Bad credentials.' }, 'Bad credentials.', 'failure'],
    ])('outcome: %s', async (_name, saved, message, state) => {
      const config = await run();
      expect(config.outcome({ prep: { card: { title: 'Connect Mailer' } }, run: { status: 'saved', saved } })).toEqual({ title: 'Connect Mailer', state, app: outcomeApp, message });
    });

    it('outcome: a failed save shows its safe message as a failure, a title fallback applies, and a silent status shows no card', async () => {
      const config = await run();
      expect(config.outcome({ prep: {}, run: { status: 'failed', safeMessage: 'Region is required.' } })).toEqual({ title: 'Provider settings', state: 'failure', app: outcomeApp, message: 'Region is required.' });
      expect(config.outcome({ prep: {}, run: { status: 'cancelled' } })).toBeUndefined();
    });
  });
});
