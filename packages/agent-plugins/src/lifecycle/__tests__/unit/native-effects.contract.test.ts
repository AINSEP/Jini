import { expect, test, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { createNodeAgentPluginEffects } from '../../node.js';

import * as bootIdentity from "@jini-ai/platform/fs/file-lock";

// REGRESSION: fails if createNodeAgentPluginEffects wraps the injected native filesystem.
test('native effects keep the filesystem ABI and share core clock and ID getters', () => {
  const effects = createNodeAgentPluginEffects({ env: {} }, { filesystem: fs });
  expect(effects.filesystem).toBe(fs);
  expect(Number.isFinite(effects.clock.nowMs())).toBe(true);
  expect(Number.isFinite(effects.clock.monotonicMs())).toBe(true);
  expect(effects.ids.newId()).toMatch(/^[0-9a-f-]{36}$/);
  expect(effects.ids.random()).toBeGreaterThanOrEqual(0);
});

// REGRESSION: fails if the native liveness adapter treats any non-EPERM failure as dead.
test('only an ESRCH probe authorizes reclaiming a local process lock', () => {
  const effects = createNodeAgentPluginEffects({ env: {} });
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

test('native plugin effects bind boot identity to the selected host map', () => {
  const env = Object.freeze({ SystemRoot: 'D:\\Host' });
  const boot = { id: 'plugin-boot', startedAtMs: 1 };
  const probe = vi.spyOn(bootIdentity, 'readBootIdentity').mockReturnValue(boot);
  try {
    const effects = createNodeAgentPluginEffects({ env });
    expect(effects.process.bootIdentity?.()).toBe(boot);
    expect(probe).toHaveBeenCalledWith({ env });
    expect(effects.process.isAlive({ pid: 0 })).toBe(false);
  } finally { probe.mockRestore(); }
});
