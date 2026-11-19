import express from 'express';
import { installRouteRegistrationGuard } from '@jini-ai/http-kit';
import type { PtyProcess, TerminalService } from '@jini-ai/core/contracts/runtime';
import { expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';

const services: TerminalService[] = [];
const child = { running: false };
const pty: PtyProcess = {
  onData() {}, onExit() {}, write() {}, resize() {},
  kill() { child.running = false; },
};

// A recording spy, not a replacement: the preset builds its own service from `options.terminal`, and
// the test needs that very service to open a session. Shutdown grace is passed as an option below.
vi.mock('@jini-ai/platform', async importOriginal => {
  const actual = await importOriginal<typeof import('@jini-ai/platform')>();
  return {
    ...actual,
    createTerminalService: (...args: Parameters<typeof actual.createTerminalService>) => {
      const service = actual.createTerminalService(...args);
      services.push(service);
      return service;
    },
  };
});

it('P9: closing the kernel terminates PTYs owned by the terminal feature', async () => {
  vi.useFakeTimers();
  const app = express();
  installRouteRegistrationGuard({ app });
  let kernel: Awaited<ReturnType<typeof composeJiniKernel>> | undefined;
  try {
    kernel = await composeJiniKernel({ env: {}, app, adapter: createTestRouteHost(), resolvedPortRef: { current: 0 },
      security: { mode: 'host' }, storage: { kind: 'memory' }, profile: 'agent-core-v1',
      capabilities: { 'host:exec': true }, features: { terminal: true },
      featureOptions: { terminal: { shutdownGraceMs: 0, loadSpawnPty: async () => () => { child.running = true; return pty; } } },
    });
    expect(services).toHaveLength(1);
    const service = services[0]!;
    const session = await service.create({ cwd: '/fixture', shell: '/bin/sh' });
    expect(child.running).toBe(true);
    expect(session.status).toBe('running');

    await kernel.close();

    expect(child.running).toBe(false);
    expect(service.get(session.id)).toMatchObject({ status: 'exited' });
  } finally {
    try {
      await kernel?.close();
      for (const service of services) await service.shutdownActive({ graceMs: 0 });
    } finally {
      services.length = 0;
      child.running = false;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }
});
