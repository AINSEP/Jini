import { describe, expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createCredentialSaveHandlers } from '../tool-registrations.js';
import { CustomCredentialDuplicateLabelError, CustomCredentialValidationError } from '../../sets/store.js';
import { ctx, makeCards, pluginCard, row, wire } from './tool-registrations.fixture.js';

function save(script: Parameters<typeof makeCards>[0], options: Parameters<typeof wire>[0] = {}) {
  const f = wire(options);
  const { cards, seen } = makeCards(script);
  const handlers = createCredentialSaveHandlers({ routeDeps: f.routeDeps, host: f.host, ports: { credentialedRequest: f.credentialedRequest }, cards, operations: f.operations, surfaces: { surfaceExchanges: {} as never } });
  return { f, seen, handlers };
}
const emitSurface = async () => undefined;
const { username: _username, ...rowNoUser } = row;

describe('rotate (set token) card', () => {
  it('re-reads the row, keeps its current username, seals the cleaned token, reports the hint', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { token: ' tok-b ' } });
    expect(await handlers.rotate(ctx({ label: 'Shop' }))).toEqual({ saved: true });
    expect(f.sets.describe).toHaveBeenCalledWith({ id: 'row-1' });
    expect(f.sets.replace).toHaveBeenCalledWith(expect.objectContaining({ id: 'row-1', principalId: 'user-1', connection: { token: 'tok-b', username: 'ann' } }));
    expect(seen.outcomes).toEqual([{ title: 'rotated Shop', state: 'success', message: 'ends WXYZ. text:saved', app: { appName: 'rotated', appVersion: '1' } }]);
    expect(seen.forms[0]).toMatchObject({ app: { appName: 'rotate', appVersion: '1' } });
    expect(seen.options[0]).toEqual({ uriHost: 'creds', text: { noEmitter: 'no rotate channel' }, emit: 'undefined' });
  });

  it('falls back to the sealed username for half-migrated rows and omits it when absent', async () => {
    const { f, handlers } = save({ status: 'submit', values: { token: 'tok-b' } });
    f.sets.describe.mockResolvedValueOnce(rowNoUser);
    f.sets.resolve.mockResolvedValueOnce({ baseUrl: row.baseUrl, connection: { token: 'old', username: 'sealed' } });
    await handlers.rotate(ctx({ label: 'Shop' }));
    expect(f.sets.replace).toHaveBeenLastCalledWith(expect.objectContaining({ connection: { token: 'tok-b', username: 'sealed' } }));
    f.sets.describe.mockResolvedValueOnce(rowNoUser);
    f.sets.resolve.mockResolvedValueOnce(null);
    await handlers.rotate(ctx({ label: 'Shop' }));
    expect(f.sets.replace).toHaveBeenLastCalledWith(expect.objectContaining({ connection: { token: 'tok-b' } }));
  });

  it('a row deleted while the form was open fails with a translated safe message and logs the summary', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { token: 'tok-b' } });
    f.sets.describe.mockResolvedValueOnce(null);
    expect(await handlers.rotate(ctx({ label: 'Shop' }))).toEqual({ saved: false, reason: 'error', message: 'tr:save failed' });
    expect(f.diagnostics.rotateFailure).toHaveBeenCalledWith({ toolId: 'cred_save', exchangeId: 'x-1', credentialId: 'row-1', errorSummary: 'Err' });
    expect(seen.outcomes[0]).toMatchObject({ state: 'failure', message: 'tr:save failed' });
    expect(f.sets.replace).not.toHaveBeenCalled();
  });

  it('blank, cancelled and other non-submits map to reasons; only blank emits an outcome', async () => {
    const blank = save({ status: 'blank' });
    expect(await blank.handlers.rotate(ctx({ label: 'Shop' }))).toEqual({ saved: false, reason: 'invalid', message: 'text:blank' });
    expect(blank.seen.outcomes[0]).toMatchObject({ state: 'failure', message: 'text:blank' });
    const expired = save({ status: 'expired' });
    expect(await expired.handlers.rotate(ctx({ label: 'Shop' }))).toEqual({ saved: false, reason: 'expired' });
    expect(expired.seen.outcomes).toEqual([undefined]);
  });

  it('refuses extra fields and unknown labels before opening a card', async () => {
    const { f, seen, handlers } = save({ status: 'cancelled' });
    await expect(handlers.rotate(ctx({ label: 'Shop', token: 'tok-x' }))).rejects.toThrow('unexpected token fields: token');
    f.sets.byLabel.mockResolvedValueOnce(null);
    await expect(handlers.rotate(ctx({ label: 'Gone' }))).rejects.toThrow('no credential Gone');
    expect(seen.forms).toEqual([]);
  });

  it('a run aborted during save throws run-ended, which becomes a failed result', async () => {
    const { f, handlers } = save({ status: 'submit', values: { token: 'tok-b' } });
    const ac = new AbortController(); ac.abort();
    expect(await handlers.rotate(ctx({ label: 'Shop' }, ac.signal))).toEqual({ saved: false, reason: 'error', message: 'tr:save failed' });
    expect(f.sets.replace).not.toHaveBeenCalled();
  });
});

describe('rotate probe of a plugin api card', () => {
  it('probes the plugin url with installed schemes and refuses a refused key', async () => {
    const { f, handlers } = save({ status: 'submit', values: { token: 'tok-b' } });
    (f.operations.pluginCards.find as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue({ ...pluginCard, probeUrl: 'https://api.shop.test/me' });
    f.credentialedRequest.probe.mockResolvedValueOnce('refused');
    const out = await handlers.rotate(ctx({ label: 'Shop' }));
    expect(out).toEqual({ saved: false, reason: 'error', message: 'tr:save failed' });
    expect(f.credentialedRequest.probe).toHaveBeenCalledWith({ connection: { token: 'tok-b', username: 'ann' }, url: 'https://api.shop.test/me', schemes: [] });
    expect(f.routeDeps.loadAuthSchemes).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    expect(f.operations.pluginCards.find).toHaveBeenCalledWith({ workspaceId: 'ws-1', saveKind: 'api', target: 'Shop' });
    expect(f.sets.replace).not.toHaveBeenCalled();
    f.credentialedRequest.probe.mockResolvedValueOnce('ok');
    expect(await handlers.rotate(ctx({ label: 'Shop' }))).toEqual({ saved: true });
  });

  it('refuses a probe url on a different origin than the saved row without probing', async () => {
    const { f, handlers } = save({ status: 'submit', values: { token: 'tok-b' } });
    (f.operations.pluginCards.find as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue({ ...pluginCard, probeUrl: 'https://evil.test/me' });
    expect(await handlers.rotate(ctx({ label: 'Shop' }))).toMatchObject({ saved: false, reason: 'error' });
    expect(f.credentialedRequest.probe).not.toHaveBeenCalled();
  });
});

describe('create card', () => {
  const values = { label: 'New', baseUrl: 'https://api.new.test', category: ' ', username: '', token: 'tok-c', worksFor: ['a'] };

  it('saves with defaults, invalidates after save, and drops the token hint from the result', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values });
    f.sets.create.mockResolvedValueOnce({ ...row, label: 'New' });
    const { tokenHint: _h, ...safe } = row;
    expect(await handlers.create(ctx(undefined), { emitSurface })).toEqual({ created: true, credential: { ...safe, label: 'New' } });
    expect(f.sets.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'New', worksFor: ['a'], category: 'general', baseUrl: 'https://api.new.test', connection: { token: 'tok-c' } }));
    expect(f.sets.create.mock.calls[0]![0]).not.toHaveProperty('additionalHosts');
    expect(f.invalidate).toHaveBeenCalledWith({ after: { ...row, label: 'New' } });
    expect(seen.outcomes[0]).toEqual({ title: 'created New', state: 'success', message: 'ends WXYZ. text:saved', app: { appName: 'created', appVersion: '1' } });
    expect(seen.options[0]).toMatchObject({ emit: 'function', text: { noEmitter: 'no create channel', saveFailure: 'save failed' } });
  });

  it('passes a username, missing fields as empty strings and a hint-less success message', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { token: 'tok-c', username: 'u1', category: 'ops' } });
    f.sets.create.mockResolvedValueOnce({ ...row, tokenHint: null } as unknown as typeof row);
    await handlers.create(ctx({}));
    expect(f.sets.create).toHaveBeenCalledWith(expect.objectContaining({ label: '', baseUrl: '', category: 'ops', worksFor: [], connection: { token: 'tok-c', username: 'u1' } }));
    expect(seen.outcomes[0]).toMatchObject({ message: 'text:saved' });
  });

  it('reads prefill hints, refusing invalid worksFor and non-free fields', async () => {
    const { seen, handlers } = save({ status: 'cancelled' });
    expect(await handlers.create(ctx({ label: 'Pre', baseUrl: ' ', worksFor: ['x'] }))).toEqual({ created: false, reason: 'cancelled' });
    expect(seen.outcomes).toEqual([undefined]);
    await expect(handlers.create(ctx({ worksFor: 'nope' }))).rejects.toThrow(new ToolInputError({ message: 'bad worksFor' }));
    await expect(handlers.create(ctx({ worksFor: ['bad!'] }))).rejects.toThrow('bad worksFor');
    await expect(handlers.create(ctx({ label: 'bad!' }))).rejects.toThrow('not free');
  });
});

describe('create card failures', () => {
  it('a duplicate label is refused with the rotate hint, using the display label', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { label: 'Shop', token: 'tok-c' } });
    f.sets.create.mockRejectedValueOnce(new CustomCredentialDuplicateLabelError('dup raw'));
    expect(await handlers.create(ctx({}))).toEqual({ created: false, reason: 'duplicate-label', message: 'duplicate Shop' });
    expect(seen.outcomes[0]).toEqual({ title: 'created Shop', state: 'failure', message: 'duplicate Shop', app: { appName: 'created', appVersion: '1' } });
    expect(f.diagnostics.createFailure).toHaveBeenCalledWith({ metadata: { toolId: 'cred_save', exchangeId: 'x-1', saved: false } });
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('a project conflict keeps the store message; validation is invalid, others error', async () => {
    const { f, handlers } = save({ status: 'submit', values: { label: 'Shop', token: 'tok-c' } });
    f.operations.policy.isProjectConflict = () => true;
    f.sets.create.mockRejectedValueOnce(new CustomCredentialDuplicateLabelError('in project'));
    expect(await handlers.create(ctx({}))).toEqual({ created: false, reason: 'duplicate-label', message: 'in project' });
    f.sets.create.mockRejectedValueOnce(new CustomCredentialValidationError('bad url tok-c'));
    expect(await handlers.create(ctx({}))).toEqual({ created: false, reason: 'invalid', message: 'tr:save failed' });
    f.sets.create.mockRejectedValueOnce(new Error('disk'));
    expect(await handlers.create(ctx({}))).toEqual({ created: false, reason: 'error', message: 'tr:save failed' });
  });

  it('a blank or non-free label displays as Untitled; blank submit reports invalid', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { label: 'x!', token: 'tok-c' } });
    f.sets.create.mockRejectedValueOnce(new Error('disk'));
    await handlers.create(ctx({}));
    expect(seen.outcomes[0]).toMatchObject({ title: 'created Untitled' });
    const blank = save({ status: 'blank' });
    expect(await blank.handlers.create(ctx({}))).toEqual({ created: false, reason: 'invalid', message: 'text:blank' });
    expect(blank.seen.outcomes[0]).toEqual({ title: 'created Untitled', state: 'failure', message: 'text:blank', app: { appName: 'created', appVersion: '1' } });
  });
});

describe('plugin provider card', () => {
  it('saves the plugin card values with its extra hosts and probes before saving', async () => {
    const { f, seen, handlers } = save({ status: 'submit', values: { token: 'tok-p' } });
    expect(await handlers.pluginProvider(ctx({ provider: 'prov' }))).toMatchObject({ created: true });
    expect(f.operations.pluginCards.readValues).toHaveBeenCalledWith({ card: pluginCard, values: { token: 'tok-p' } });
    expect(f.sets.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Plug key', baseUrl: 'https://api.plug.test', additionalHosts: ['cdn.plug.test'], worksFor: [], connection: { token: 'tok-p' } }));
    expect(seen.forms[0]).toMatchObject({ title: 'Form' });
    expect(f.permissions).toEqual(['cred.write']);
  });

  it('omits additionalHosts when the card has none and reports an unavailable probe', async () => {
    const { f, handlers } = save({ status: 'submit', values: { token: 'tok-p' } });
    (f.operations.pluginCards.readValues as ReturnType<typeof import('vitest').vi.fn>).mockReturnValue({ label: 'Plug key', category: 'general', baseUrl: 'https://api.plug.test', token: 'tok-p' });
    await handlers.pluginProvider(ctx({ provider: 'prov' }));
    expect(f.sets.create.mock.calls[0]![0]).not.toHaveProperty('additionalHosts');
    (f.operations.pluginCards.load as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue([{ ...pluginCard, probeUrl: 'https://api.plug.test/me' }]);
    f.credentialedRequest.probe.mockResolvedValueOnce('unavailable');
    Object.assign(f.operations, { formErrors: [{ error: CustomCredentialValidationError }] });
    const out = await handlers.pluginProvider(ctx({ provider: 'prov' }));
    expect(out).toEqual({ created: false, reason: 'invalid', message: 'tr:probe unavailable starts pk false' });
    expect(f.sets.create).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown provider', async () => {
    const { handlers } = save({ status: 'cancelled' });
    await expect(handlers.pluginProvider(ctx({ provider: 'missing' }))).rejects.toThrow(new ToolInputError({ message: 'no card missing' }));
  });
});
