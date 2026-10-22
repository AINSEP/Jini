import { test, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentPluginLifecycle } from '../../index.js';
import { AgentPluginActivationsBusyError } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

// Generalized D1/D2: real filesystem effects, with observations injected through the port.
test('temp file is synced before publication and directory synced afterwards', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-durable-'));
  const events: string[] = [];
  const filesystem = {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { events.push(`sync:${path.basename(String(args[0]))}`); await sync(); };
      return handle;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      events.push(`rename:${path.basename(String(args[1]))}`); await fs.rename(...args);
    },
  };
  const api = createAgentPluginLifecycle({ ...ports, filesystem });
  try {
    await api.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: false, actor: 'operator' });
    const sync = events.findIndex(e => e.startsWith('sync:activations.json.tmp-'));
    const rename = events.indexOf('rename:activations.json');
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(rename).toBeGreaterThan(sync);
    if (process.platform !== 'win32') expect(events.indexOf(`sync:${path.basename(root)}`)).toBeGreaterThan(rename);
    expect((await api.readAgentPluginActivations({ workspaceRoot: root })).plugins['plugin-a']?.enabled).toBe(false);
  } finally { await forceRemove(root); }
});

test('a failed temp sync leaves the recorded decision and removes the temporary file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-sync-fault-'));
  const baseline = createAgentPluginLifecycle(ports);
  try {
    await baseline.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: false, actor: 'first' });
    const before = await fs.readFile(path.join(root, 'activations.json'), 'utf8');
    const filesystem = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (String(args[0]).includes('activations.json.tmp-')) handle.sync = async () => { throw new Error('sync failed'); };
      return handle;
    } };
    const api = createAgentPluginLifecycle({ ...ports, filesystem });
    await expect(api.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'second' })).rejects.toThrow('sync failed');
    expect(await fs.readFile(path.join(root, 'activations.json'), 'utf8')).toBe(before);
    expect(await fs.readdir(root)).toEqual(['activations.json']);
  } finally { await forceRemove(root); }
});

// REGRESSION: fails if activation returns to token-only ownership checks before publication.
test('a replacement lock inode with identical holder bytes cannot authorize publication', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-inode-loss-'));
  const lockPath = path.join(root, 'activations.json.lock');
  const filesystem = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    if (String(args[0]).includes('activations.json.tmp-')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        const bytes = await fs.readFile(lockPath);
        const replacement = path.join(root, 'replacement.lock');
        await fs.writeFile(replacement, bytes);
        await fs.rename(replacement, lockPath);
      };
    }
    return handle;
  } };
  try {
    const api = createAgentPluginLifecycle({ ...ports, filesystem });
    await expect(api.setAgentPluginActivation({ workspaceRoot: root, pluginId: 'plugin-a', enabled: true, actor: 'operator' }))
      .rejects.toBeInstanceOf(AgentPluginActivationsBusyError);
    await expect(fs.stat(path.join(root, 'activations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(root)).toEqual(['activations.json.lock']);
  } finally { await forceRemove(root); }
});
