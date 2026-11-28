import { describe, expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createCredentialToolRegistrations } from '../tool-registrations.js';
import { CustomCredentialNotFoundError, CustomCredentialValidationError } from '../../sets/store.js';
import { ctx, ids, pluginCard, row, wire } from './tool-registrations.fixture.js';

function tools(options: Parameters<typeof wire>[0] = {}) {
  const f = wire(options);
  const regs = createCredentialToolRegistrations({ routeDeps: f.routeDeps, host: f.host, ports: { credentialedRequest: f.credentialedRequest, sourceControlWrite: f.sourceControlWrite }, operations: f.operations });
  const byId = (id: string) => regs.find(r => r.descriptor.id === id)!.handler;
  return { f, regs, byId };
}

describe('credential list / verify / set-username tools', () => {
  it('registers the five catalog tools in order', () => {
    expect(tools().regs.map(r => r.descriptor.id)).toEqual([ids.list, ids.verify, ids.setUsername, ids.makeRequest, ids.writeFiles]);
  });

  it('list strips token hints and annotates rows owned by an api plugin card', async () => {
    const { f, byId } = tools();
    f.sets.list.mockResolvedValueOnce([row, { ...row, id: 'row-2', label: 'Plug key' }]);
    const { tokenHint: _hint, ...safe } = row;
    expect(await byId(ids.list)(ctx({}))).toEqual({ credentials: [safe, { ...safe, id: 'row-2', label: 'Plug key', pluginId: 'plug', usedFor: ['images'] }] });
    expect(f.permissions).toEqual(['cred.read']);
  });

  it('list ignores non-api plugin cards and defaults usedFor to []', async () => {
    const { f, byId } = tools();
    (f.operations.pluginCards.load as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValueOnce([
      { ...pluginCard, saveKind: 'oauth', label: 'Shop' }, { ...pluginCard, saveKind: 'api', ownedApiLabel: 'Shop', usedFor: undefined }]);
    const { tokenHint: _hint, ...safe } = row;
    expect(await byId(ids.list)(ctx({}))).toEqual({ credentials: [{ ...safe, pluginId: 'plug', usedFor: [] }] });
  });

  it('list refuses any input and a denied permission', async () => {
    await expect(tools().byId(ids.list)(ctx({ x: 1 }))).rejects.toThrow();
    await expect(tools({ allow: false }).byId(ids.list)(ctx({}))).rejects.toThrow(/denied here/);
  });

  it('verify runs the port through recovery with verification true', async () => {
    const { f, byId } = tools();
    expect(await byId(ids.verify)(ctx({ label: 'Shop' }))).toEqual({ status: 'ok', message: 'fine', checkedAt: 'now' });
    expect(f.credentialedRequest.verify).toHaveBeenCalledWith({ workspaceId: 'ws-1', label: 'Shop' });
    expect(f.operations.recovery.withSetup).toHaveBeenCalledWith(expect.objectContaining({ label: 'Shop', verification: true }), {});
  });

  it('set-username sets, clears, and refuses extra fields, missing and blank usernames', async () => {
    const { f, byId } = tools();
    const h = byId(ids.setUsername);
    expect(await h(ctx({ label: 'Shop', username: 'bob' }))).toEqual({ ...row, username: 'bob' });
    expect(f.sets.setUsername).toHaveBeenCalledWith({ id: 'row-1', username: 'bob' });
    await h(ctx({ label: 'Shop', username: null }));
    expect(f.sets.setUsername).toHaveBeenLastCalledWith({ id: 'row-1', username: null });
    expect(f.permissions).toEqual(['cred.write', 'cred.write']);
    await expect(h(ctx({ label: 'Shop', username: 'x', token: 't' }))).rejects.toThrow('unexpected username fields: token');
    await expect(h(ctx({ label: 'Shop' }))).rejects.toThrow('username required');
    await expect(h(ctx({ label: 'Shop', username: '  ' }))).rejects.toThrow('username invalid');
    await expect(h(ctx({ label: 'Shop', username: 4 }))).rejects.toThrow(CustomCredentialValidationError);
  });

  it('set-username refuses an unknown label and an aborted run', async () => {
    const { f, byId } = tools();
    f.sets.byLabel.mockResolvedValueOnce(null);
    await expect(byId(ids.setUsername)(ctx({ label: 'Nope', username: 'a' }))).rejects.toThrow(new CustomCredentialNotFoundError('no credential Nope'));
    const ac = new AbortController(); ac.abort(new Error('stop'));
    await expect(byId(ids.setUsername)(ctx({ label: 'Shop', username: 'a' }, ac.signal))).rejects.toThrow('stop');
    expect(f.sets.setUsername).not.toHaveBeenCalled();
  });
});

describe('credential make-request tool', () => {
  it('non-DELETE requests pass headers/body to the port as optional input', async () => {
    const { f, byId } = tools();
    const out = await byId(ids.makeRequest)(ctx({ label: 'Shop', method: 'GET', url: 'https://api.shop.test/a', headers: { h: '1' }, body: 'b' }));
    expect(out).toEqual({ executed: true, status: 200, headers: {}, bodyText: 'ok' });
    expect(f.credentialedRequest.request).toHaveBeenCalledWith({ workspaceId: 'ws-1', label: 'Shop', method: 'GET', url: 'https://api.shop.test/a' }, { headers: { h: '1' }, body: 'b' });
    expect(f.permissions).toEqual(['cred.write']);
  });

  it('validation and egress refusals become schema-decorated input errors; others rethrow', async () => {
    const { f, byId } = tools();
    const h = byId(ids.makeRequest);
    const input = { label: 'Shop', method: 'POST', url: 'https://x.test/' };
    f.credentialedRequest.request.mockRejectedValue(new Error('raw 10.0.0.1'));
    f.credentialedRequest.classifyError.mockReturnValueOnce({ category: 'egress-refused', error: new Error('x'), callerSafeMessage: 'host refused', callerSafeError: new Error('x') });
    const err = (await h(ctx(input)).catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toMatch(/^host refused\. .*Schema for 'cred_request'/);
    expect(err.message).not.toContain('10.0.0.1');
    f.credentialedRequest.classifyError.mockReturnValueOnce({ category: 'validation', error: new Error('x'), callerSafeMessage: 'bad method' });
    await expect(h(ctx(input))).rejects.toThrow(/^bad method\./);
    f.credentialedRequest.classifyError.mockReturnValueOnce({ category: 'transport', error: new Error('x') });
    await expect(h(ctx(input))).rejects.toThrow('raw 10.0.0.1');
  });
});

describe('credential make-request DELETE approval', () => {
  const del = { label: 'Shop', method: 'DELETE', url: 'https://api.shop.test/items/1?x=2', headers: { h: '1' } };
  const emitSurface = async () => undefined;

  it('asks a human with the resolved target, then sends after approval', async () => {
    const { f, byId } = tools();
    const out = await byId(ids.makeRequest)(ctx(del), { emitSurface });
    expect(out).toEqual({ executed: true, status: 200, headers: {}, bodyText: 'ok' });
    expect(f.credentialedRequest.resolveTarget).toHaveBeenCalledWith({ workspaceId: 'ws-1', label: 'Shop', url: del.url });
    expect(f.operations.approval.askHuman).toHaveBeenCalledWith(expect.objectContaining({ description: expect.objectContaining({ title: 'delete Shop api.shop.test/items/1?x=2' }) }), expect.anything());
    expect(f.credentialedRequest.request).toHaveBeenCalledWith({ workspaceId: 'ws-1', label: 'Shop', method: 'DELETE', url: del.url }, { headers: { h: '1' }, body: undefined });
    expect(f.permissions).toEqual(['cred.write', 'cred.write']);
  });

  it('declined is cancelled; expiry passes its reason through; nothing is sent', async () => {
    const declined = tools({ approval: { confirmed: false, reason: 'declined' } });
    expect(await declined.byId(ids.makeRequest)(ctx(del), { emitSurface })).toEqual({ executed: false, cancelled: true });
    const expired = tools({ approval: { confirmed: false, reason: 'expired' } });
    expect(await expired.byId(ids.makeRequest)(ctx(del), { emitSurface })).toEqual({ executed: false, cancelled: false, reason: 'expired' });
    expect(declined.f.credentialedRequest.request).not.toHaveBeenCalled();
    expect(expired.f.credentialedRequest.request).not.toHaveBeenCalled();
  });

  it('fails closed without a surface channel and is abandoned when already aborted', async () => {
    const { f, byId } = tools();
    await expect(byId(ids.makeRequest)(ctx(del))).rejects.toThrow(new ToolInputError({ message: 'no delete channel' }));
    const ac = new AbortController(); ac.abort();
    expect(await byId(ids.makeRequest)(ctx(del, ac.signal), { emitSurface })).toEqual({ executed: false, cancelled: false, reason: 'abandoned' });
    expect(f.operations.approval.askHuman).not.toHaveBeenCalled();
  });

  it('is abandoned, and sends nothing, when the run ends while the confirmed request re-checks permission', async () => {
    const { f, byId } = tools();
    const ac = new AbortController();
    let confirmed = false;
    (f.operations.approval.askHuman as ReturnType<typeof import('vitest').vi.fn>).mockImplementationOnce(async () => { confirmed = true; return { confirmed: true }; });
    const authorize = f.routeDeps.authorize;
    f.routeDeps.authorize = async (required) => { if (confirmed) ac.abort(); return authorize(required); };
    expect(await byId(ids.makeRequest)(ctx(del, ac.signal), { emitSurface })).toEqual({ executed: false, cancelled: false, reason: 'abandoned' });
    expect(f.operations.approval.askHuman).toHaveBeenCalledTimes(1);
    expect(f.credentialedRequest.request).not.toHaveBeenCalled();
  });

  it('returns a setup failure from recovery without asking, and maps validation target errors', async () => {
    const { f, byId } = tools();
    const setup = { executed: false as const, credentialSetup: { hint: 'reconnect' } };
    (f.operations.recovery.withSetup as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValueOnce(setup);
    expect(await byId(ids.makeRequest)(ctx(del), { emitSurface })).toBe(setup);
    f.credentialedRequest.resolveTarget.mockRejectedValue(new Error('raw'));
    f.credentialedRequest.classifyError.mockReturnValueOnce({ category: 'validation', error: new Error('raw'), callerSafeMessage: 'off allowlist' });
    await expect(byId(ids.makeRequest)(ctx(del), { emitSurface })).rejects.toThrow('off allowlist');
    await expect(byId(ids.makeRequest)(ctx(del), { emitSurface })).rejects.toThrow('raw');
    expect(f.operations.approval.askHuman).not.toHaveBeenCalled();
  });
});

describe('credential write-files tool', () => {
  const input = { label: 'Shop', owner: 'o', repo: 'r', branch: 'main', commitMessage: 'm', files: [{ path: 'a.txt', content: 'A' }] };

  it('plans then commits the same plan with the bearer header built from the resolved token', async () => {
    const { f, byId } = tools();
    expect(await byId(ids.writeFiles)(ctx(input))).toEqual({ executed: true, commitSha: 'c1', commitUrl: 'https://git.test/c1', filesWritten: 1 });
    const target = { baseUrl: 'https://api.shop.test', authorization: 'Bearer tok-a', owner: 'o', repo: 'r' };
    expect(f.sourceControlWrite.build).toHaveBeenCalledWith({ workspaceId: 'ws-1', baseUrl: 'https://api.shop.test' });
    expect(f.sourceControlWrite.planFileWrite).toHaveBeenCalledWith({ provider: f.provider, input: { ...target, branch: 'main', files: input.files } });
    expect(f.sourceControlWrite.commitFiles).toHaveBeenCalledWith({ provider: f.provider, input: { ...target, branch: 'main', commitMessage: 'm', files: input.files }, plan: f.plan });
  });

  it('shape rejections become input errors; missing rows are not-found', async () => {
    const { f, byId } = tools();
    (f.operations.policy.validateWriteFiles as ReturnType<typeof import('vitest').vi.fn>).mockImplementationOnce(() => { throw new CustomCredentialValidationError('path escapes root'); });
    await expect(byId(ids.writeFiles)(ctx(input))).rejects.toBeInstanceOf(ToolInputError);
    f.sets.byLabel.mockResolvedValueOnce(null);
    await expect(byId(ids.writeFiles)(ctx(input))).rejects.toThrow('no credential Shop');
    f.sets.resolve.mockResolvedValueOnce(null);
    await expect(byId(ids.writeFiles)(ctx(input))).rejects.toThrow(CustomCredentialNotFoundError);
  });

  it('build and plan failures throw the write-failure message; plan failure is logged', async () => {
    const { f, byId } = tools();
    f.sourceControlWrite.build.mockResolvedValueOnce({ ok: false, message: 'no provider', refusals: [] });
    await expect(byId(ids.writeFiles)(ctx(input))).rejects.toThrow('write failed: no provider');
    const failure = { ok: false, code: 'branch-not-found', message: 'no branch' };
    f.sourceControlWrite.planFileWrite.mockResolvedValueOnce(failure);
    await expect(byId(ids.writeFiles)(ctx(input))).rejects.toThrow('write failed: no branch');
    expect(f.diagnostics.writeFailure).toHaveBeenCalledWith({ phase: 'plan', failure });
  });

  it('abandons after planning when aborted, and reports a commit failure as an error result', async () => {
    const { f, byId } = tools();
    const ac = new AbortController(); ac.abort();
    expect(await byId(ids.writeFiles)(ctx(input, ac.signal))).toEqual({ executed: false, cancelled: false, reason: 'abandoned' });
    expect(f.sourceControlWrite.commitFiles).not.toHaveBeenCalled();
    const failure = { ok: false, code: 'diverged', message: 'branch moved' };
    f.sourceControlWrite.commitFiles.mockResolvedValueOnce(failure);
    expect(await byId(ids.writeFiles)(ctx(input))).toEqual({ executed: false, cancelled: false, reason: 'error', message: 'branch moved' });
    expect(f.diagnostics.writeFailure).toHaveBeenCalledWith({ phase: 'commit', failure });
  });
});
