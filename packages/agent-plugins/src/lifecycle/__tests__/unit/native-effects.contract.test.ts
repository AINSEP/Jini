import { expect, test, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { createNodeAgentPluginEffects } from '../../node.js';

// REGRESSION: fails if createNodeAgentPluginEffects wraps the injected native filesystem.
test('native effects keep the filesystem ABI and share core clock and ID getters', () => {
  const effects = createNodeAgentPluginEffects({}, { filesystem: fs });
  expect(effects.filesystem).toBe(fs);
  expect(Number.isFinite(effects.clock.nowMs())).toBe(true);
  expect(Number.isFinite(effects.clock.monotonicMs())).toBe(true);
  expect(effects.ids.newId()).toMatch(/^[0-9a-f-]{36}$/);
  expect(effects.ids.random()).toBeGreaterThanOrEqual(0);
});

// REGRESSION: fails if the native liveness adapter treats any non-EPERM failure as dead.
test('only an ESRCH probe authorizes reclaiming a local process lock', () => {
  const effects = createNodeAgentPluginEffects({});
  const probe = vi.spyOn(process, 'kill');
  try {
    for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) {
      probe.mockImplementationOnce(() => { throw Object.assign(new Error('probe failed'), { code }); });
      expect(effects.process.isAlive({ pid: process.pid })).toBe(true);
    }
    probe.mockImplementationOnce(() => { throw Object.assign(new Error('missing process'), { code: 'ESRCH' }); });
    expect(effects.process.isAlive({ pid: process.pid })).toBe(false);
  } finally { probe.mockRestore(); }
});
