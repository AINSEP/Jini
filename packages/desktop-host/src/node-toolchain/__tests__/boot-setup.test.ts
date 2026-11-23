/**
 * Launch-time mechanics a desktop host runs once per boot: the bundled toolchain's best-effort env
 * preparation, and the two independent cancellation lanes of background site discovery. Ported from
 * the host's own boot-step tests; the host keeps the warning copy and the env-variable names.
 */
import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createSiteDiscoveryLanes, prepareNodeToolchainEnvBestEffort, type NodeToolchainSetupEvent } from '../index.js';

function toolchain(write: () => { toolchainDir: string } | null) {
  const events: NodeToolchainSetupEvent[] = [];
  const builds: unknown[] = [];
  const writes: unknown[] = [];
  const env = prepareNodeToolchainEnvBestEffort({
    userDataDir: '/ud', electronPath: '/Sample.app/Sample', npmRoot: '/npm',
    writeNodeToolchain: (input) => { writes.push(input); return write(); },
    buildNodeToolchainEnv: (input) => { builds.push(input); return { HOST_TOOLCHAIN_DIR: input.toolchainDir, HOST_NPM_ROOT: input.npmRoot }; },
    report: (event) => { events.push(event); },
  });
  return { env, events, builds, writes };
}

it('a written toolchain yields the host-named env contract and reports nothing', () => {
  const t = toolchain(() => ({ toolchainDir: '/ud/node-toolchain' }));
  assert.deepEqual(t.writes, [{ userDataDir: '/ud', electronPath: '/Sample.app/Sample', npmRoot: '/npm' }]);
  assert.deepEqual(t.builds, [{ toolchainDir: '/ud/node-toolchain', npmRoot: '/npm' }]);
  assert.deepEqual(t.env, { HOST_TOOLCHAIN_DIR: '/ud/node-toolchain', HOST_NPM_ROOT: '/npm' });
  assert.deepEqual(t.events, []);
});

it('a disk-image launch turns the toolchain off and reports a transient launch', () => {
  const t = toolchain(() => null);
  assert.equal(t.env, undefined);
  assert.deepEqual(t.builds, []);
  assert.deepEqual(t.events, [{ kind: 'transient-launch' }]);
});

it('a failed write degrades to no toolchain, reports the error and never throws', () => {
  const failure = new Error('EROFS');
  const t = toolchain(() => { throw failure; });
  assert.equal(t.env, undefined);
  assert.deepEqual(t.builds, []);
  assert.equal(t.events.length, 1);
  assert.equal(t.events[0]!.kind, 'write-failed');
  assert.equal((t.events[0] as { error: unknown }).error, failure);
});

function lanes() {
  const signals: { scanRoots: string[] | undefined; signal: AbortSignal }[] = [];
  const l = createSiteDiscoveryLanes({ discover: async (input) => { signals.push(input); return signals.length; } });
  return { l, signals };
}

it('a new rescan aborts the previous rescan but not a running picker validation', async () => {
  const { l, signals } = lanes();
  assert.equal(await l.discoverSites({}), 1);
  await l.discoverSites({ scanRoots: ['/picked'] });
  await l.discoverSites({});
  const [rescan1, validation, rescan2] = signals;
  assert.equal(rescan1!.scanRoots, undefined);
  assert.deepEqual(validation!.scanRoots, ['/picked']);
  assert.equal(rescan1!.signal.aborted, true);
  assert.equal(validation!.signal.aborted, false);
  assert.equal(rescan2!.signal.aborted, false);
});

it('a new picker validation aborts the previous validation but not a running rescan', async () => {
  const { l, signals } = lanes();
  await l.discoverSites({});
  await l.discoverSites({ scanRoots: ['/a'] });
  await l.discoverSites({ scanRoots: ['/b'] });
  assert.deepEqual(signals.map((s) => s.signal.aborted), [false, true, false]);
});

it('before-quit aborts the live scan of both lanes; with none started it is a no-op', async () => {
  const empty = lanes();
  assert.doesNotThrow(() => empty.l.abortAll());
  const { l, signals } = lanes();
  await l.discoverSites({});
  await l.discoverSites({ scanRoots: ['/a'] });
  l.abortAll();
  assert.deepEqual(signals.map((s) => s.signal.aborted), [true, true]);
});

// The boot discovery pass is started without awaiting it. A discoverer that throws synchronously
// must surface as a rejection of that pass, never as a throw into the caller's boot sequence.
it('a failed background discovery rejects its own promise instead of throwing into boot', async () => {
  const failure = new Error('volume stalled');
  const l = createSiteDiscoveryLanes({ discover: () => { throw failure; } });
  let pending: Promise<unknown> | undefined;
  assert.doesNotThrow(() => { pending = l.discoverSites({}); });
  await assert.rejects(pending!, failure);
  // The failed scan still owns its lane, so before-quit can abort it and a later scan replaces it.
  assert.doesNotThrow(() => l.abortAll());
});
