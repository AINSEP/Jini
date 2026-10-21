/**
 * Edge inputs at several host boundaries: a zero readiness budget, an unparseable capture URL, an
 * empty POSIX launcher path, the default quit deadline timer, and an invalid speech sample cap.
 */
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { buildNodeToolchainShims } from '../node-toolchain/index.js';
import { createNodeSidecarLauncher } from '../sidecar.js';
import { routeQuitSignals } from '../shutdown/index.js';
import { registerSpeechIpc } from '../speech/speech-ipc.js';
import { isCaptureUrlAllowed } from '../url-capture.js';

it('waitUntilReady with no time budget rejects at once, without probing', async () => {
  const handle = await createNodeSidecarLauncher({}).launch({ command: process.execPath }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
  let probes = 0;
  try {
    await expect(handle.waitUntilReady({ probe: async () => { probes++; return true; }, isReady: () => true }, { timeoutMs: 0 }))
      .rejects.toThrow('timed out waiting for sidecar to become ready');
    expect(probes).toBe(0);
  } finally {
    await handle.shutdown({}, { gracefulTimeoutMs: 200 });
  }
});

it('refuses a capture URL that does not parse', () => {
  expect(isCaptureUrlAllowed({ url: 'http://[not-a-host', allowedOrigins: ['http://[not-a-host'] })).toBe(false);
  expect(isCaptureUrlAllowed({ url: 'relative/path', allowedOrigins: [] })).toBe(false);
});

it('refuses an empty Electron path for the POSIX launchers before building any script', () => {
  expect(() => buildNodeToolchainShims({ electronPath: '', npmRoot: '/opt/npm', platform: 'linux', generatedComment: '# generated', joinPath: ({ parts }) => parts.join('/') }))
    .toThrow('node-toolchain: electronPath must be a non-empty string.');
});

it('arms the force-exit deadline on the real timer when no timer is injected', async () => {
  const processLike = new EventEmitter();
  const calls: string[] = [];
  routeQuitSignals({
    processLike: { on: ({ signal, listener }) => processLike.on(signal, listener) },
    quit: () => { calls.push('quit'); },
    forceExit: () => { calls.push('force-exit'); },
    deadlineMs: 5,
  });
  processLike.emit('SIGTERM');
  expect(calls).toEqual(['quit']);
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(calls).toEqual(['quit', 'force-exit']);
});

it.each([-1, 1.5, Number.POSITIVE_INFINITY])('refuses a speech sample cap of %s before registering any handler', maxSamples => {
  const registered: string[] = [];
  const register = () => registerSpeechIpc({
    ipcMain: { handle: ({ channel }) => { registered.push(channel); } },
    port: { isAvailable: async () => ({ available: true }), transcribe: async () => ({ text: '', elapsedMs: 0 }) },
    channelNamespace: 'app:speech', isTrustedSender: () => true,
    messages: { senderRefused: 'refused', invalidRate: 'rate', invalidSamples: 'samples', missingSenderGuard: 'guard', tooManySamples: ({ maxSamples: cap }) => `at most ${cap} samples` },
  }, { maxSamples });
  expect(register).toThrow(RangeError);
  expect(register).toThrow(`at most ${maxSamples} samples`);
  expect(registered).toEqual([]);
});
