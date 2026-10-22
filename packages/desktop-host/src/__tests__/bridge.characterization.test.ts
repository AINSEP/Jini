import { describe, expect, it } from 'vitest';
import { isJiniHostBridge, openHostPath, openHostExternalUrl, checkJiniHostUpdaterAvailability } from '../bridge.js';
import { createMockJiniHost } from '../bridge-testing.js';

describe('bridge validation before complexity refactoring', () => {
  it.each([undefined, null, [], 'bridge', 1])('rejects a non-record bridge: %s', value => {
    expect(isJiniHostBridge({ value })).toBe(false);
  });

  it.each([undefined, null, [], 'electron'])('rejects a non-record client: %s', client => {
    expect(isJiniHostBridge({ value: { ...createMockJiniHost({}), client } })).toBe(false);
  });

  it.each([
    [{ type: 'electron' }, true], [{ type: 'tauri' }, true],
    [{ type: 1 }, false], [{ type: 'web' }, false],
    [{ type: 'electron', platform: null, osLocale: null }, true],
    [{ type: 'electron', platform: 'linux', osLocale: 'en' }, true],
    [{ type: 'electron', platform: false }, false],
    [{ type: 'electron', osLocale: false }, false],
  ])('preserves client metadata validation: %j', (client, accepted) => {
    expect(isJiniHostBridge({ value: { ...createMockJiniHost({}), client } })).toBe(accepted);
  });

  it('keeps version, shell and updater validation independent', () => {
    const host = createMockJiniHost({});
    expect(isJiniHostBridge({ value: { ...host, version: 2 } })).toBe(false);
    for (const shell of [null, [], {}, { openExternal() {} }, { openExternal() {}, openPath: true }]) {
      expect(isJiniHostBridge({ value: { ...host, shell } })).toBe(false);
    }
    for (const updater of [null, [], {}, { checkAvailability: true }]) {
      expect(isJiniHostBridge({ value: { ...host, updater } })).toBe(false);
    }
    expect(isJiniHostBridge({ value: { ...host, updater: undefined } })).toBe(true);
    expect(isJiniHostBridge({ value: { ...host, updater: { checkAvailability() {} } } })).toBe(true);
  });

  it('keeps exact unavailable results and thrown error normalization', async () => {
    const scope = {};
    const missing = { ok: false, reason: 'jini host is not available' };
    expect(await openHostPath({ path: '/test' }, { scope })).toEqual(missing);
    expect(await openHostExternalUrl({ url: 'https://test.example' }, { scope })).toEqual(missing);
    expect(await checkJiniHostUpdaterAvailability({}, { scope })).toEqual(missing);
    const host = createMockJiniHost({});
    expect(await checkJiniHostUpdaterAvailability({}, { scope: { __jini__: host } })).toEqual({
      ok: false, reason: 'host build does not support the updater extension point',
    });
    for (const error of [new Error('native failure'), 'native failure']) {
      const reject = async () => { throw error; };
      const failing = { __jini__: { ...host, shell: { openPath: reject, openExternal: reject }, updater: { checkAvailability: reject } } };
      const expected = { ok: false, reason: 'native failure' };
      expect(await openHostPath({ path: '/test' }, { scope: failing })).toEqual(expected);
      expect(await openHostExternalUrl({ url: 'https://test.example' }, { scope: failing })).toEqual(expected);
      expect(await checkJiniHostUpdaterAvailability({}, { scope: failing })).toEqual(expected);
    }
  });
});
