import { describe, expect, it, vi } from 'vitest';
import { ToolInputError, type SurfaceEmission, type SurfaceExchange, type SurfaceMessage, type ToolExecutionContext } from '@jini-ai/core';
import { parseUIResource } from '../resource.js';
import { defineSecretCardTool, type SecretCardDeps, type SecretCardField, type SecretCardForm, type SecretCardOptions, type SecretCardRun, type SecretCardSpec } from '../secret-card.js';

// Synthetic input only. No stored credential is read by these specifications.
const CANARY = 'secret-card-test-canary';
type Prep = { target: string };
type Saved = { id: string };
type Result = { saved: true; id: string } | { saved: false; reason: string; message?: string };

// Compiled with the package: a structural variable must not bypass the no-prefill rule.
type Assert<Condition extends true> = Condition;
export type SecretCardTypeChecks = [
  Assert<{ kind: 'string'; name: 'token'; label: 'Token'; secret: true; value: string } extends SecretCardField ? false : true>,
  Assert<{ kind: 'string'; name: 'token'; label: 'Token'; secret: true; allowBlank: true } extends SecretCardField ? true : false>,
  Assert<{ kind: 'string'; name: 'label'; label: 'Label'; value: string } extends SecretCardField ? true : false>,
];

function fixture(options: SecretCardOptions = {}) {
  const controller = new AbortController();
  const ctx: ToolExecutionContext = { executionId: 'call-1', principal: { id: 'actor-1' }, run: { id: 'run-1' }, input: {}, signal: controller.signal };
  const emissions: SurfaceEmission[] = [];
  const emit = vi.fn(async (emission: SurfaceEmission) => { emissions.push(emission); });
  let answer: SurfaceMessage | undefined = { status: 'received', params: { token: CANARY } };
  let waiting: ((message: SurfaceMessage) => void) | undefined;
  let announceReceive!: () => void;
  const receiving = new Promise<void>(resolve => { announceReceive = resolve; });
  let closed = false;
  const exchange: SurfaceExchange = {
    id: 'exchange-1',
    expiresAtMs: () => 0,
    send: vi.fn(async ({ emission }: { emission: SurfaceEmission }) => { await emit(emission); }),
    receive: vi.fn(async () => {
      announceReceive();
      if (answer) return answer;
      return new Promise<SurfaceMessage>(resolve => { waiting = resolve; });
    }),
    close: vi.fn(() => { closed = true; answer = { status: 'abandoned' }; waiting?.(answer); }),
  };
  const form: { -readonly [Key in keyof SecretCardForm]: SecretCardForm[Key] } = { title: 'Enter credential', submitLabel: 'Save', fields: [{ kind: 'string', name: 'token', label: 'Token', secret: true }] };
  const prepare = vi.fn(async () => ({ target: 'entry-1' }));
  const save = vi.fn(async (_required: { values: Readonly<Record<string, unknown>>; prep: Prep; signal: AbortSignal }) => ({ id: 'saved-1' }));
  const result = vi.fn(({ run }: { prep: Prep; run: SecretCardRun<Saved> }): Result => {
    if (run.status === 'saved') return { saved: true, id: run.saved.id };
    if (run.status === 'failed') return { saved: false, reason: 'failed', message: run.safeMessage };
    return { saved: false, reason: run.status };
  });
  const spec: SecretCardSpec<Prep, Saved, Result> = {
    toolId: 'save_credential', prepare, form: () => form, save, result,
    outcome: ({ run }) => {
      if (run.status === 'saved') return { state: 'success', title: 'Saved', message: 'Credential saved.' };
      if (run.status === 'failed') return { state: 'failure', title: 'Not saved', message: run.safeMessage };
      return undefined;
    },
  };
  // This DI fake observes the engine's ask/report outputs. The daemon's own suite verifies
  // transport send ordering, best-effort outcome delivery and helper-level finally-close.
  // It deliberately does not close: these assertions exercise the engine's independent cleanup.
  const deps: SecretCardDeps = {
    surfaceExchanges: { open: vi.fn(() => exchange) },
    askThenReport: async required => {
      await required.exchange.send({ emission: required.confirmationEmission });
      const handled = await required.handle(await required.exchange.receive({}));
      if (handled.outcome) await required.exchange.send({ emission: handled.outcome });
      return handled.result;
    },
  };
  const run = () => defineSecretCardTool(spec, options).handler(deps)(ctx, { emitSurface: emit });
  return {
    controller, ctx, emissions, emit, exchange, form, prepare, save, result, spec, deps, run, receiving,
    setAnswer: (next: SurfaceMessage | undefined) => { answer = next; },
    isClosed: () => closed,
  };
}

function resourceAt(emissions: readonly SurfaceEmission[], index: number) {
  const resource = parseUIResource(emissions[index]?.payload['resource']);
  if (!resource) throw new Error('Expected an engine-produced UI resource');
  return resource.resource;
}

describe('secret-card lifecycle', () => {
  it('fails closed with exact typed text when the transport has no emitter', async () => {
    const f = fixture();
    await expect(defineSecretCardTool(f.spec).handler(f.deps)(f.ctx)).rejects.toEqual(new ToolInputError({ message: 'save_credential: this execution context has no interactive form channel (no emitSurface), so this form cannot be shown here. Nothing was changed.' }));
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.deps.surfaceExchanges.open).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.emissions).toEqual([]);
  });

  it('retains exact host-specific fail-closed text', async () => {
    const f = fixture();
    await expect(defineSecretCardTool(f.spec, { text: { noEmitter: 'This card requires an interactive channel.' } }).handler(f.deps)(f.ctx)).rejects.toEqual(new ToolInputError({ message: 'This card requires an interactive channel.' }));
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['before prepare', 'during prepare', 'during form'] as const)('abort %s means no card and no write', async phase => {
    const f = fixture();
    if (phase === 'before prepare') f.controller.abort();
    if (phase === 'during prepare') f.prepare.mockImplementation(async () => { f.controller.abort(); return { target: 'entry-1' }; });
    if (phase === 'during form') f.spec.form = () => { f.controller.abort(); return f.form; };
    expect(await f.run()).toEqual({ saved: false, reason: 'abandoned' });
    expect(f.deps.surfaceExchanges.open).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.emissions).toEqual([]);
  });

  it('closes an abort between opening and registering the listener', async () => {
    const f = fixture();
    f.deps.surfaceExchanges.open = vi.fn(() => { f.controller.abort(); return f.exchange; });
    expect(await f.run()).toEqual({ saved: false, reason: 'abandoned' });
    expect(f.isClosed()).toBe(true);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.emissions).toEqual([]);
  });

  it('abort while parked wakes the call, removes the listener, and never saves', async () => {
    const f = fixture();
    f.setAnswer(undefined);
    const remove = vi.spyOn(f.ctx.signal, 'removeEventListener');
    const pending = f.run();
    await f.receiving;
    f.controller.abort();
    expect(await pending).toEqual({ saved: false, reason: 'abandoned' });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.isClosed()).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('an abort wins over a received answer that was buffered before closure', async () => {
    const f = fixture();
    f.exchange.receive = vi.fn(async (): Promise<SurfaceMessage> => { f.controller.abort(); return { status: 'received', params: { token: CANARY } }; });
    expect(await f.run()).toEqual({ saved: false, reason: 'abandoned' });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.isClosed()).toBe(true);
  });

  it.each([
    [{ status: 'received', params: { __dismissed: true, token: CANARY } }, 'cancelled'],
    [{ status: 'expired' }, 'expired'],
    [{ status: 'abandoned' }, 'abandoned'],
  ] as const)('classifies %j without persistence', async (answer, reason) => {
    const f = fixture();
    f.setAnswer(answer);
    expect(await f.run()).toEqual({ saved: false, reason });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.emissions).toHaveLength(1);
    expect(f.isClosed()).toBe(true);
  });

  it.each(['', ' \r\n\t ', undefined, 42, { value: 'not a string' }])('refuses blank or malformed required secrets (%j)', async token => {
    const f = fixture();
    f.setAnswer({ status: 'received', params: { token } });
    expect(await f.run()).toEqual({ saved: false, reason: 'blank' });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.isClosed()).toBe(true);
  });

  it('allowBlank is a real behavioral seam, while default blank policy refuses the same input', async () => {
    const baseline = fixture();
    baseline.setAnswer({ status: 'received', params: { token: '' } });
    const treatment = fixture();
    treatment.form.fields = [{ kind: 'string', name: 'token', label: 'Token', secret: true, allowBlank: true }];
    treatment.setAnswer({ status: 'received', params: { token: '' } });
    expect(await baseline.run()).toEqual({ saved: false, reason: 'blank' });
    expect(await treatment.run()).toEqual({ saved: true, id: 'saved-1' });
    expect(treatment.save).toHaveBeenCalledWith({ values: { token: '' }, prep: { target: 'entry-1' }, signal: treatment.ctx.signal });
    // Only allowBlank differs: successful package output demonstrates optional stored-value preservation.
  });

  it('missing optional secrets become blank without needing a stored-value prefill', async () => {
    const f = fixture();
    f.form.fields = [{ kind: 'string', name: 'token', label: 'Token', secret: true, allowBlank: true }];
    f.setAnswer({ status: 'received', params: {} });
    expect(await f.run()).toEqual({ saved: true, id: 'saved-1' });
    expect(f.save.mock.calls[0]?.[0].values).toEqual({ token: '' });
  });

  it('an optional-secret policy still refuses object payloads', async () => {
    const f = fixture();
    f.form.fields = [{ kind: 'string', name: 'token', label: 'Token', secret: true, allowBlank: true }];
    f.setAnswer({ status: 'received', params: { token: {} } });
    expect(await f.run()).toEqual({ saved: false, reason: 'blank' });
    expect(f.save).not.toHaveBeenCalled();
  });

  it('allowBlank preserves an empty update but still refuses whitespace-only input', async () => {
    const f = fixture();
    f.form.fields = [{ kind: 'string', name: 'token', label: 'Token', secret: true, allowBlank: true }];
    f.setAnswer({ status: 'received', params: { token: ' \r\n\t ' } });
    expect(await f.run()).toEqual({ saved: false, reason: 'blank' });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.isClosed()).toBe(true);
  });

  it('preserves exact secret bytes and projects only declared names to the save port', async () => {
    const f = fixture();
    const token = ` \r\n${CANARY}\r\n `;
    f.form.fields = [...f.form.fields, { kind: 'string', name: 'label', label: 'Label', value: 'Original' }];
    f.setAnswer({ status: 'received', params: { token, label: 'Changed', __exchangeId: 'exchange-1', injected: 'discarded' } });
    expect(await f.run()).toEqual({ saved: true, id: 'saved-1' });
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith({ values: { token, label: 'Changed' }, prep: { target: 'entry-1' }, signal: f.ctx.signal });
    expect(JSON.stringify(f.emissions)).not.toContain(CANARY);
    expect(f.isClosed()).toBe(true);
  });

  it('retains native non-secret field values instead of stringifying the form owner output', async () => {
    const f = fixture();
    f.form.fields = [...f.form.fields,
      { kind: 'number', name: 'port', label: 'Port' },
      { kind: 'boolean', name: 'enabled', label: 'Enabled' },
      { kind: 'multi-enum', name: 'scopes', label: 'Scopes', options: [{ value: 'read', label: 'Read' }] },
    ];
    f.setAnswer({ status: 'received', params: { token: CANARY, port: 443, enabled: true, scopes: ['read'] } });
    expect(await f.run()).toEqual({ saved: true, id: 'saved-1' });
    expect(f.save.mock.calls[0]?.[0].values).toEqual({ token: CANARY, port: 443, enabled: true, scopes: ['read'] });
    expect(JSON.stringify(f.emissions)).not.toContain(CANARY);
    expect(f.isClosed()).toBe(true);
  });

  it('replaces the form at its own URI after a successful save', async () => {
    const f = fixture({ uriHost: 'host', frameSize: ['100%', '420px'] });
    expect(await f.run()).toEqual({ saved: true, id: 'saved-1' });
    expect(f.deps.surfaceExchanges.open).toHaveBeenCalledWith({ binding: { toolId: 'save_credential', principalId: 'actor-1', channel: 'mcp-ui' }, emit: f.emit });
    expect(f.emissions.map(emission => emission.channel)).toEqual(['mcp-ui', 'mcp-ui']);
    const form = resourceAt(f.emissions, 0);
    const outcome = resourceAt(f.emissions, 1);
    expect(form.uri).toBe('ui://host/secret-card/save_credential/exchange-1');
    expect(outcome.uri).toBe(form.uri);
    expect(outcome.text).toContain('Credential saved.');
    expect(form._meta?.['mcpui.dev/ui-preferred-frame-size']).toEqual(['100%', '420px']);
    expect(form.text).toContain('var BASE_PARAMS = {"__exchangeId":"exchange-1"}');
    expect(form.text).toContain('"__dismissed":true');
    expect(form.text).toContain('"toolName":"save_credential"');
  });

  it('leaves the card open and sends no success outcome before the save resolves', async () => {
    const f = fixture();
    let finish!: (saved: Saved) => void;
    let started!: () => void;
    const saving = new Promise<void>(resolve => { started = resolve; });
    f.save.mockImplementation(() => { started(); return new Promise<Saved>(resolve => { finish = resolve; }); });
    const pending = f.run();
    await saving;
    expect(f.emissions).toHaveLength(1);
    expect(f.isClosed()).toBe(false);
    finish({ id: 'saved-1' });
    expect(await pending).toEqual({ saved: true, id: 'saved-1' });
    expect(f.emissions).toHaveLength(2);
    expect(f.isClosed()).toBe(true);
  });

  it('maps a save exception to fixed text, with no canary in results, outcomes or log metadata', async () => {
    const logFailure = vi.fn();
    const f = fixture({ logFailure });
    f.save.mockRejectedValue(new Error(`Provider rejected ${CANARY}`));
    const output = await f.run();
    expect(output).toEqual({ saved: false, reason: 'failed', message: 'Saving failed. Nothing was saved.' });
    expect(resourceAt(f.emissions, 1).text).toContain('Saving failed. Nothing was saved.');
    expect(logFailure).toHaveBeenCalledTimes(1);
    expect(logFailure).toHaveBeenCalledWith({ toolId: 'save_credential', exchangeId: 'exchange-1', saved: false });
    expect(JSON.stringify({ output, emissions: f.emissions, logs: logFailure.mock.calls })).not.toContain(CANARY);
    expect(f.isClosed()).toBe(true);
  });

  it('safeError changes the actual failure output compared with the same unmapped error', async () => {
    const baseline = fixture();
    const treatment = fixture({ safeError: error => error instanceof ToolInputError ? 'That target was removed.' : undefined });
    for (const f of [baseline, treatment]) f.save.mockRejectedValue(new ToolInputError({ message: 'internal detail' }));
    expect(await baseline.run()).toEqual({ saved: false, reason: 'failed', message: 'Saving failed. Nothing was saved.' });
    expect(await treatment.run()).toEqual({ saved: false, reason: 'failed', message: 'That target was removed.' });
    // The same error is observed by both runs; only the fixed-kind mapper changes the package output.
  });

  it('a mapper that accidentally returns the submitted secret is redacted', async () => {
    const f = fixture({ safeError: () => `Could not save ${CANARY}` });
    f.save.mockRejectedValue(new Error('Provider failed'));
    expect(await f.run()).toEqual({ saved: false, reason: 'failed', message: 'Could not save [REDACTED:exact_secret]' });
    expect(JSON.stringify(f.emissions)).not.toContain(CANARY);
  });

  it('unrecognized errors use the host fixed failure text', async () => {
    const f = fixture({ safeError: () => undefined, text: { saveFailure: 'Storage is unavailable.' } });
    f.save.mockRejectedValue(new Error(CANARY));
    expect(await f.run()).toEqual({ saved: false, reason: 'failed', message: 'Storage is unavailable.' });
  });

  it('mapper and logger failures cannot replace the fixed safe response', async () => {
    const f = fixture({ safeError: () => { throw new Error(CANARY); }, logFailure: () => { throw new Error(CANARY); } });
    f.save.mockRejectedValue(new Error(CANARY));
    expect(await f.run()).toEqual({ saved: false, reason: 'failed', message: 'Saving failed. Nothing was saved.' });
    expect(JSON.stringify(f.emissions)).not.toContain(CANARY);
    expect(f.isClosed()).toBe(true);
  });

  it('cancellation during a cancellable save reaches the port and returns abandoned', async () => {
    const f = fixture();
    f.save.mockImplementation(async ({ signal }) => { f.controller.abort(); expect(signal.aborted).toBe(true); throw new Error(CANARY); });
    expect(await f.run()).toEqual({ saved: false, reason: 'abandoned' });
    expect(f.emissions).toHaveLength(1);
    expect(f.isClosed()).toBe(true);
  });

  it.each(['form send', 'form render', 'result projection', 'outcome projection'] as const)('finally closes on %s failure and detaches abort', async phase => {
    const f = fixture();
    const remove = vi.spyOn(f.ctx.signal, 'removeEventListener');
    if (phase === 'form send') f.emit.mockRejectedValue(new Error('Transport unavailable'));
    if (phase === 'result projection') f.spec.result = () => { throw new Error('Projection unavailable'); };
    if (phase === 'outcome projection') f.spec.outcome = () => { throw new Error('Projection unavailable'); };
    if (phase === 'form render') Object.defineProperty(f.form, 'title', { get: () => { throw new Error('Render unavailable'); } });
    const message = phase === 'form send' ? 'Transport unavailable' : phase === 'form render' ? 'Render unavailable' : 'Projection unavailable';
    await expect(f.run()).rejects.toThrow(message);
    expect(f.isClosed()).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    if (phase === 'form send' || phase === 'form render') expect(f.save).not.toHaveBeenCalled();
  });

  it('prepare failure never opens a card or writes', async () => {
    const f = fixture();
    f.prepare.mockRejectedValue(new ToolInputError({ message: 'Permission denied.' }));
    await expect(f.run()).rejects.toEqual(new ToolInputError({ message: 'Permission denied.' }));
    expect(f.deps.surfaceExchanges.open).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['__exchangeId', '__dismissed', '__typedAnswer', 'token', ''])('rejects reserved, duplicate or empty names (%s) before opening', async name => {
    const f = fixture();
    f.form.fields = [...f.form.fields, { kind: 'string', name, label: 'Invalid' }];
    await expect(f.run()).rejects.toEqual(new ToolInputError({ message: 'Secret card field names must be unique and cannot use exchange parameters.' }));
    expect(f.deps.surfaceExchanges.open).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('runtime prefill attempts fail closed before a card is emitted', async () => {
    const f = fixture();
    f.form.fields = [{ kind: 'string', name: 'token', label: 'Token', secret: true, value: CANARY } as unknown as SecretCardField];
    await expect(f.run()).rejects.toEqual(new ToolInputError({ message: 'Secret fields cannot have a pre-filled value. Omit value.' }));
    expect(f.deps.surfaceExchanges.open).not.toHaveBeenCalled();
    expect(f.emissions).toEqual([]);
  });

  it('reports dynamic secret names without any stored-value lookup', () => {
    const f = fixture();
    f.spec.form = ({ prep }) => ({ ...f.form, fields: prep.target === 'oauth'
      ? [{ kind: 'string', name: 'clientSecret', label: 'Client secret', secret: true, allowBlank: true }]
      : f.form.fields });
    const tool = defineSecretCardTool(f.spec);
    expect(tool.toolId).toBe('save_credential');
    expect(tool.secretFieldNames({ target: 'oauth' })).toEqual(['clientSecret']);
    expect(tool.secretFieldNames({ target: 'token' })).toEqual(['token']);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('two concurrent cards keep their field policies, results and URIs separate', async () => {
    const left = fixture({ uriHost: 'left' });
    const right = fixture({ uriHost: 'right' });
    right.form.fields = [{ kind: 'string', name: 'clientSecret', label: 'Client secret', secret: true, allowBlank: true }];
    right.setAnswer({ status: 'received', params: { clientSecret: '' } });
    right.save.mockResolvedValue({ id: 'saved-2' });
    expect(await Promise.all([left.run(), right.run()])).toEqual([{ saved: true, id: 'saved-1' }, { saved: true, id: 'saved-2' }]);
    expect(resourceAt(left.emissions, 0).uri).toBe('ui://left/secret-card/save_credential/exchange-1');
    expect(resourceAt(right.emissions, 0).uri).toBe('ui://right/secret-card/save_credential/exchange-1');
    expect(right.save.mock.calls[0]?.[0].values).toEqual({ clientSecret: '' });
    expect(left.isClosed()).toBe(true);
    expect(right.isClosed()).toBe(true);
  });

  it('domain specs retain distinct create and credential result projections', async () => {
    const creation = fixture();
    const cancellation = fixture();
    cancellation.setAnswer({ status: 'received', params: { __dismissed: true } });
    const createSpec = { ...creation.spec, result: ({ run }: { prep: Prep; run: SecretCardRun<Saved> }) => ({ created: run.status === 'saved' }) };
    const credentialSpec = { ...cancellation.spec, result: ({ run }: { prep: Prep; run: SecretCardRun<Saved> }) => ({ saved: run.status === 'saved', credentialId: 'entry-1', cancelled: run.status === 'cancelled', message: 'Nothing was saved.' }) };
    expect(await defineSecretCardTool(createSpec).handler(creation.deps)(creation.ctx, { emitSurface: creation.emit })).toEqual({ created: true });
    expect(await defineSecretCardTool(credentialSpec).handler(cancellation.deps)(cancellation.ctx, { emitSurface: cancellation.emit })).toEqual({ saved: false, credentialId: 'entry-1', cancelled: true, message: 'Nothing was saved.' });
    expect(cancellation.save).not.toHaveBeenCalled();
    expect(JSON.stringify([...creation.emissions, ...cancellation.emissions])).not.toContain(CANARY);
    expect(creation.isClosed()).toBe(true);
    expect(cancellation.isClosed()).toBe(true);
  });

  const secretField = (name: string, options: { multiline?: boolean; allowBlank?: boolean } = {}): SecretCardField => ({ kind: 'string', name, label: name, secret: true, ...options });
  const publicField = (name: string): SecretCardField => ({ kind: 'string', name, label: name, value: 'Public metadata' });
  const variants: { toolId: string; fields: readonly SecretCardField[] }[] = [
    { toolId: 'custom_credential_create', fields: [publicField('label'), publicField('baseUrl'), publicField('username'), secretField('token')] },
    { toolId: 'custom_credential_set_token', fields: [secretField('token', { allowBlank: true })] },
    { toolId: 'media_propose_provider_credential', fields: [secretField('apiKey')] },
    { toolId: 'source_control_propose_credential', fields: [publicField('provider'), secretField('token'), secretField('privateKey', { multiline: true, allowBlank: true })] },
    { toolId: 'deployment_propose_custom_provider_credential', fields: [publicField('endpoint'), publicField('bucket'), secretField('accessKey'), secretField('secretKey')] },
    { toolId: 'agent_plugin_set_access_token', fields: [secretField('accessToken')] },
    { toolId: 'identity_user_create', fields: [publicField('email'), secretField('password')] },
    { toolId: 'database_transfer_set_destination', fields: [secretField('connectionString', { multiline: true })] },
    { toolId: 'deployment_ops_set_secret', fields: [secretField('value', { multiline: true })] },
    { toolId: 'external_mcp_save', fields: [publicField('label'), { kind: 'enum', name: 'oauthGrant', label: 'Grant', options: [{ value: 'authorization_code', label: 'Browser' }] }, secretField('accessToken', { allowBlank: true }), secretField('env', { multiline: true, allowBlank: true }), secretField('oauthClientSecret', { allowBlank: true })] },
  ];

  it.each(variants)('$toolId can supply its own fields, checks, save port and projection without a stored secret', async ({ toolId, fields }) => {
    const f = fixture();
    const spec = { ...f.spec, toolId, form: () => ({ ...f.form, fields }) };
    const params = Object.fromEntries(fields.map(field => [field.name, field.secret === true ? ` \r\n${CANARY}\r\n ` : 'Human metadata']));
    f.setAnswer({ status: 'received', params: { ...params, undeclared: 'discarded' } });
    const output = await defineSecretCardTool(spec).handler(f.deps)(f.ctx, { emitSurface: f.emit });
    expect(output).toEqual({ saved: true, id: 'saved-1' });
    expect(f.prepare).toHaveBeenCalledWith({ ctx: f.ctx });
    expect(f.save).toHaveBeenCalledWith({ values: params, prep: { target: 'entry-1' }, signal: f.ctx.signal });
    expect(resourceAt(f.emissions, 0).uri).toBe(`ui://jini/secret-card/${toolId}/exchange-1`);
    expect(resourceAt(f.emissions, 1).uri).toBe(resourceAt(f.emissions, 0).uri);
    expect(JSON.stringify({ output, emissions: f.emissions })).not.toContain(CANARY);
    expect(f.isClosed()).toBe(true);
  });
});
