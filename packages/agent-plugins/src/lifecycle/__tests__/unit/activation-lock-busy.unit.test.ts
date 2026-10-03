import { test, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentPluginLifecycle, AgentPluginActivationsBusyError } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

// REGRESSION: fails if activation uses the old monotonic timeout instead of the canonical Clock.
// Generalized B1: force contention through the actual lock protocol, without module mocks.
// Advance after the stale verdict (start, ownership, stale), so a fresh owner is never evicted.
test('busy activation lock reports the holder and preserves both the lock and decisions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-busy-'));
  const lock = path.join(root, 'activations.json.lock');
  const holder = { pid: process.pid, hostname: os.hostname(), token: 'other-writer', acquiredAt: new Date().toISOString() };
  const baselineMs = Date.now();
  let clockReads = 0;
  const api = createAgentPluginLifecycle({ ...ports, clock: { ...ports.clock, nowMs: () => baselineMs + (++clockReads > 3 ? 20_000 : 0) } });
  try {
    const bytes = JSON.stringify(holder);
    await fs.writeFile(lock, bytes);
    const action = api.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'operator' });
    await expect(action).rejects.toBeInstanceOf(AgentPluginActivationsBusyError);
    await expect(action).rejects.toMatchObject({ holder });
    expect(await fs.readFile(lock, 'utf8')).toBe(bytes);
    await expect(fs.stat(path.join(root, 'activations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(root); }
});
