import express from 'express';
import { installRouteRegistrationGuard } from '@jini-ai/http-kit';
import type { PtyProcess, TerminalService } from '@jini-ai/core/contracts/runtime';
import { createTerminalService } from '@jini-ai/platform';
import { expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import { nodeOsPorts } from './fixtures/node-os-ports.js';

const child = { running: false };
const pty: PtyProcess = {
  onData() {}, onExit() {}, write() {}, resize() {},
  kill() { child.running = false; },
};

it('P9: closing the kernel terminates PTYs owned by the terminal feature', async () => {
  vi.useFakeTimers();
  // The host builds the service itself (the preset takes it as given), so the test holds the very service the kernel owns.
  const service: TerminalService = createTerminalService({ shutdownGraceMs: 0, loadSpawnPty: async () => () => { child.running = true; return pty; } });
  const app = express();
  installRouteRegistrationGuard({ app });
  let kernel: Awaited<ReturnType<typeof composeJiniKernel>> | undefined;
  try {
    kernel = await composeJiniKernel({
      app, adapter: createTestRouteHost(), resolvedPortRef: { current: 0 },
      security: { mode: 'host' }, osPorts: nodeOsPorts, storage: { kind: 'memory' }, profile: 'agent-core-v1',
      capabilities: { 'host:exec': true }, features: { terminal: true },
      featureOptions: { terminal: { terminalService: service } },
    });
    const session = await service.create({ cwd: '/fixture', shell: '/bin/sh' });
    expect(child.running).toBe(true);
    expect(session.status).toBe('running');

    await kernel.close();

    expect(child.running).toBe(false);
    expect(service.get(session.id)).toMatchObject({ status: 'exited' });
  } finally {
    try {
      await kernel?.close();
      await service.shutdownActive({ graceMs: 0 });
    } finally {
      child.running = false;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }
});
