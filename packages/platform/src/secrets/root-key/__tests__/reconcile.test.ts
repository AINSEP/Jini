import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fingerprintRootKeyHex } from '../../keyring.env.js';
import { reconcileRootKey, type RootKeyReconcilePorts, type RootKeyStampRead } from '../reconcile.js';

const key = '11'.repeat(32), other = '22'.repeat(32), winner = '33'.repeat(32);
const fingerprint = (hex: string) => fingerprintRootKeyHex({ hex });

function fixture(required: { perSite?: string; others?: readonly (() => string | undefined)[]; stamped?: string; meta?: RootKeyStampRead; dependent?: boolean; winner?: string } = {}) {
  const calls: string[] = [];
  const ports: RootKeyReconcilePorts = {
    readPerSite: () => { calls.push('per-site'); return required.perSite; }, others: required.others ?? [], stampedFingerprint: required.stamped,
    hasDependentData: async () => { calls.push('scan'); return required.dependent === true; },
    moveAside: ({ expectedContent }) => { calls.push(`aside:${expectedContent}`); },
    createExclusive: ({ hex }) => { calls.push(`create:${hex}`); return required.winner ?? hex; },
    mint: () => { calls.push('mint'); return key; },
    readStamp: () => { calls.push('stamp'); return required.meta ?? { kind: 'no-meta' }; },
  };
  return { ports, calls };
}

test('mismatched adoption with dependent data writes and stamps nothing', async () => {
  const f = fixture({ others: [() => key], stamped: fingerprint(other), dependent: true });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'mismatch', fingerprint: fingerprint(key) });
  assert.deepEqual(f.calls, ['per-site', 'scan']);
});

test('a stamp-named key in another source replaces a different per-site file by move-aside, never delete', async () => {
  let writes = 0;
  const raw = ` ${other}\n`;
  const f = fixture({ perSite: raw, others: [() => key], stamped: fingerprint(key), meta: { kind: 'meta', fingerprint: fingerprint(key), write: () => { writes++; } } });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'adopt', fingerprint: fingerprint(key) });
  assert.deepEqual(f.calls, ['per-site', `aside:${raw}`, `create:${key}`, 'stamp']);
  assert.equal(writes, 0);
});

test('a differing stamp with dependent data reports mismatch and does not restamp', async () => {
  let writes = 0;
  const f = fixture({ others: [() => key], dependent: true, meta: { kind: 'meta', fingerprint: fingerprint(other), write: () => { writes++; } } });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'mismatch', fingerprint: fingerprint(key) });
  assert.deepEqual(f.calls, ['per-site', `create:${key}`, 'stamp', 'scan']);
  assert.equal(writes, 0);
});

test("a lost create race returns the winner's fingerprint", async () => {
  const f = fixture({ winner });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'mint', fingerprint: fingerprint(winner) });
  assert.deepEqual(f.calls, ['per-site', 'scan', 'mint', `create:${key}`, 'stamp']);
});

test('the dependent-data scan runs at most once per reconcile', async () => {
  let written: string | undefined;
  const f = fixture({ others: [() => key], stamped: fingerprint(other), meta: { kind: 'meta', fingerprint: fingerprint(other), write: ({ fingerprint }) => { written = fingerprint; } } });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'adopt', fingerprint: fingerprint(key) });
  assert.equal(f.calls.filter(call => call === 'scan').length, 1);
  assert.equal(written, fingerprint(key));
});

test('absent everywhere with dependent data refuses and writes nothing', async () => {
  const f = fixture({ dependent: true });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'refuse' });
  assert.deepEqual(f.calls, ['per-site', 'scan']);
});

test('a later source is not read once the stamped key is found', async () => {
  const f = fixture({ others: [() => key, () => { throw new Error('later source read'); }], stamped: fingerprint(key) });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'adopt', fingerprint: fingerprint(key) });
});

test('no meta file means no stamp write, and the action is unchanged', async () => {
  const f = fixture({ perSite: key });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'noop', fingerprint: fingerprint(key) });
  assert.deepEqual(f.calls, ['per-site', 'stamp']);
});

test('an unstamped meta file is stamped once', async () => {
  const writes: string[] = [];
  const f = fixture({ perSite: key, meta: { kind: 'meta', fingerprint: undefined, write: ({ fingerprint }) => { writes.push(fingerprint); } } });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'noop', fingerprint: fingerprint(key) });
  assert.deepEqual(writes, [fingerprint(key)]);
});

test('invalid first-present material stops before a later valid source without a stamp', async () => {
  const f = fixture({ others: [() => 'invalid', () => { throw new Error('later source read'); }] });
  assert.deepEqual(await reconcileRootKey({ ports: f.ports }), { action: 'invalid', reason: 'not-hex' });
  assert.deepEqual(f.calls, ['per-site']);
});

test('the fingerprint getter is read after per-site material and before later sources', async () => {
  const order: string[] = [];
  const f = fixture({ others: [() => { order.push('other'); return key; }] });
  Object.defineProperty(f.ports, 'readPerSite', { value: () => { order.push('per-site'); return undefined; } });
  Object.defineProperty(f.ports, 'stampedFingerprint', { get: () => { order.push('stamp'); return fingerprint(key); } });
  await reconcileRootKey({ ports: f.ports });
  assert.deepEqual(order.slice(0, 3), ['per-site', 'stamp', 'other']);
});
