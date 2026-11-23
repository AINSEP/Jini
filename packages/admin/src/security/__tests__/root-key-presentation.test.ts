import { describe, it, expect, vi } from 'vitest';
import { createMemoryRootKey } from '../adapters/memory.js';
import { createRootKeyController } from '../controllers/root-key.controller.js';
import { classifyRootKeyRefusal, rootKeyBadge, rootKeySourceNote } from '../rules.js';
import type { RootKeyState, RootKeyStatus } from '../models.js';
const GRANT = ['admin.security.tokens.manage'];
const KEY = 'a3f9'.repeat(16);
const status = (state: RootKeyState, over: Partial<RootKeyStatus> = {}): RootKeyStatus => ({ active: false, source: 'none', state, keyFilePath: '/k', runtimeMode: 'local', ...over });
/** The host's reader: its error type carries a public code and detail. */
class Refusal extends Error { constructor(readonly code: string, readonly detail?: string) { super(`${code} ${KEY}`); } }
const describeError = ({ error }: { error: unknown }) => error instanceof Refusal ? { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) } : {};
async function controller(state: RootKeyStatus, error?: unknown) {
  const api = createMemoryRootKey({ status: state }); const generate = vi.spyOn(api, 'generate');
  if (error) generate.mockRejectedValue(error);
  const c = createRootKeyController({ api, permissions: GRANT }, { describeError }); await c.load({}); return { c, generate };
}

describe('root-key badge (SEC-5, ported from site-key-status.rules)', () => {
  it('labels an inactive key None', () => { expect(rootKeyBadge({ status: status('missing') })).toEqual({ label: 'None', tone: 'info' }); });
  it('labels a file key', () => { expect(rootKeyBadge({ status: status('active', { active: true, source: 'file' }) })).toEqual({ label: 'Active — key file', tone: 'success' }); });
  it('names the env var from the status, else the host default', () => {
    expect(rootKeyBadge({ status: status('active', { active: true, source: 'env', envVarName: 'FROM_SERVER' }) }, { defaultEnvVarName: 'X' })).toMatchObject({ label: 'Active: environment variable {name}', vars: { name: 'FROM_SERVER' } });
    expect(rootKeyBadge({ status: status('active', { active: true, source: 'env' }) }, { defaultEnvVarName: 'X' })).toMatchObject({ vars: { name: 'X' } });
    expect(rootKeyBadge({ status: status('active', { active: true, source: 'env' }) })).toEqual({ label: 'Active — environment variable', tone: 'success' });
  });
  it('warns for an invalid key', () => { expect(rootKeyBadge({ status: status('invalid', { active: true, source: 'file', invalid: true }) }).tone).toBe('warning'); });
});
describe('root-key source note (SEC-5)', () => {
  it('shows a file path as its own field', () => { expect(rootKeySourceNote({ status: status('active', { active: true, source: 'file' }) })).toEqual({ text: 'Stored in a file on this server, at', path: '/k' }); });
  it('names the env var to fix for an invalid env key', () => { expect(rootKeySourceNote({ status: status('invalid', { source: 'env', invalid: true }) }, { defaultEnvVarName: 'X' }).vars).toEqual({ name: 'X' }); });
  it('says an invalid file must be replaced by hand', () => { expect(rootKeySourceNote({ status: status('invalid', { source: 'file', invalid: true }) })).toMatchObject({ text: 'The key file at', path: '/k' }); });
  it('says the env key needs nothing', () => { expect(rootKeySourceNote({ status: status('active', { active: true, source: 'env' }) }).text).toMatch(/^This key was set up directly on the server/); });
  it('differs for no key by generate visibility', () => {
    expect(rootKeySourceNote({ status: status('missing') }, { generate: 'hidden' }).text).toBe('A key is created automatically when this site starts.');
    expect(rootKeySourceNote({ status: status('missing') }).text).toBe('No key yet. Create one to protect saved credentials.');
  });
});
describe('root-key refusals (SEC-5, ported from site-key-generate-error)', () => {
  it.each([['KEY_DEPENDENT_DATA', 'locked'], ['KEY_MISMATCH', 'locked'], ['KEY_INVALID', 'refused'], ['SITE_META_UNREADABLE', 'refused'], ['ALREADY_EXISTS', 'already-exists'], ['OTHER', 'generic']] as const)('%s is %s', (code, kind) => {
    expect(classifyRootKeyRefusal({ code, detail: 'd' }).kind).toBe(kind);
  });
  it('classifies only known codes and never carries the reader detail', () => {
    expect(classifyRootKeyRefusal({ code: 'KEY_INVALID', detail: '' })).toEqual({ kind: 'refused', code: 'KEY_INVALID' });
    expect(classifyRootKeyRefusal({ code: 'ALREADY_EXISTS', detail: 'x' })).toEqual({ kind: 'already-exists', code: 'ALREADY_EXISTS' });
    expect(classifyRootKeyRefusal({ code: 'OTHER', detail: `echo ${KEY}` })).toEqual({ kind: 'generic' });
  });
  it('KEY_DEPENDENT_DATA sets the locked refusal by code only', async () => {
    const { c } = await controller(status('missing'), new Refusal('KEY_DEPENDENT_DATA', 'Saved data needs its key.'));
    expect(await c.generate({})).toBe(false);
    expect(c.getSnapshot().generateError).toEqual({ kind: 'locked', code: 'KEY_DEPENDENT_DATA' });
  });
  it('a secret echoed in the reader detail never reaches the snapshot, for a known or an unknown code', async () => {
    for (const code of ['KEY_INVALID', 'OTHER']) {
      const { c } = await controller(status('missing'), new Refusal(code, `stamp ${KEY} is not hex`));
      await c.generate({}); expect(JSON.stringify(c.getSnapshot())).not.toContain(KEY);
    }
  });
  it('never puts a raw error message that echoes a key into any snapshot field', async () => {
    const { c } = await controller(status('missing'), new Refusal('OTHER'));
    await c.generate({}); expect(JSON.stringify(c.getSnapshot())).not.toContain(KEY);
  });
  it('clears the previous refusal when a new write starts', async () => {
    const { c, generate } = await controller(status('missing'), new Refusal('KEY_INVALID', 'x'));
    await c.generate({}); generate.mockResolvedValue({ outcome: 'created', fingerprint: 'f', keyFilePath: '/k', runtimeMode: 'local' });
    await c.generate({}); expect(c.getSnapshot().generateError).toBeNull();
  });
});
describe('root-key generate guard (SEC-5)', () => {
  it.each([
    ['an active key', status('active', { active: true })],
    ['an env source', status('missing', { source: 'env' })],
    ['a file source', status('missing', { source: 'file' })],
  ])('refuses %s without calling the port', async (_name, given) => {
    const { c, generate } = await controller(given);
    expect(await c.generate({})).toBe(false); expect(generate).not.toHaveBeenCalled();
  });
  it('creates when there is no key at all', async () => {
    const { c, generate } = await controller(status('missing'));
    expect(await c.generate({})).toBe(true); expect(generate).toHaveBeenCalledTimes(1);
  });
});
