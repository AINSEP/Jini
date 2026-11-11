/**
 * @file `createPersistentStateModule` forwards its host ports into the platform lock (hostname and
 * token land in the lock file) and its migration refuses a legacy package whose manifest id does not
 * parse, quarantining it WITH the parser's own errors as the reason. Closes Stryker run-2 survivors
 * at persistent-state.ts:16-17 (port lambdas) and 28-30 (`parsePluginId`).
 */
import { afterEach, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseAgentPluginManifest } from '../../manifest.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import type { AgentPluginLifecyclePorts } from '../../ports.js';
import { forceRemove } from '../fixtures/force-remove.js';
import { ports as defaultPorts } from '../test-support.js';

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function temporary() { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-pstate-'))); temporaries.push(dir); return dir; }

test('the identity lock is written with the host port\'s hostname and a token from the ids port', async () => {
  const workspaceRoot = await temporary();
  const ports: AgentPluginLifecyclePorts = {
    ...defaultPorts,
    process: { ...defaultPorts.process, hostname: () => 'host-under-test' },
    ids: { ...defaultPorts.ids, newId: () => 'token-under-test' },
  };
  const lock = await createPersistentStateModule(ports).withIdentityLock({
    workspaceRoot, run: async () => fs.readFile(path.join(workspaceRoot, '.publisher-identity.lock'), 'utf8'),
  });
  expect(JSON.parse(lock)).toMatchObject({ hostname: 'host-under-test', token: 'token-under-test', pid: process.pid });
});

test('a contended lock waits through the clock port (sleep + monotonic) and then runs', async () => {
  const workspaceRoot = await temporary();
  const sleeps: number[] = [];
  let monotonic = 0;
  const ports: AgentPluginLifecyclePorts = {
    ...defaultPorts,
    clock: { ...defaultPorts.clock, monotonicMs: () => (monotonic += 1), sleep: async ({ ms }) => { sleeps.push(ms); await fs.rm(path.join(workspaceRoot, '.publisher-identity.lock'), { force: true }); } },
  };
  await fs.writeFile(path.join(workspaceRoot, '.publisher-identity.lock'), JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'other', acquiredAt: new Date().toISOString() }));
  await expect(createPersistentStateModule(ports).withIdentityLock({ workspaceRoot, run: async () => 'ran' })).resolves.toBe('ran');
  expect(sleeps.length).toBeGreaterThan(0);
  expect(sleeps.every((ms) => typeof ms === 'number' && ms > 0)).toBe(true);
  expect(monotonic).toBeGreaterThan(0);
});

test('migration quarantines a legacy package whose manifest name does not parse, reporting the parser errors', async () => {
  const workspaceRoot = await temporary();
  const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'Not A Valid Id!' };
  const parsed = parseAgentPluginManifest({ value: manifest });
  expect(parsed.ok).toBe(false);
  const reason = parsed.ok ? '' : parsed.errors.join('; ');
  const legacy = path.join(workspaceRoot, 'packages', 'sha256', 'e'.repeat(64));
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'plugin.json'), JSON.stringify(manifest));
  const events: { event: string; message: string }[] = [];
  const state = createPersistentStateModule({ ...defaultPorts, onEvent: (event) => events.push(event) });
  expect(await state.migrate({ workspaceRoot })).toEqual({ complete: true, moved: 0 });
  const quarantined = events.filter((event) => event.event === 'migration-quarantined');
  expect(quarantined).toHaveLength(1);
  expect(quarantined[0]!.message.endsWith(`: Error: ${reason}`)).toBe(true);
});

test('migration moves a legacy package whose manifest parses into that plugin\'s own folder', async () => {
  const workspaceRoot = await temporary();
  const digest = 'f'.repeat(64);
  const legacy = path.join(workspaceRoot, 'packages', 'sha256', digest);
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'good-plugin' }));
  const state = createPersistentStateModule(defaultPorts);
  expect(await state.migrate({ workspaceRoot })).toEqual({ complete: true, moved: 1 });
  await expect(fs.stat(path.join(workspaceRoot, 'good-plugin', 'package', 'sha256', digest, 'plugin.json'))).resolves.toBeTruthy();
});
