import express from 'express';
import { installRouteRegistrationGuard } from '@jini-ai/http-kit';
import type { TerminalSessionManager } from '@jini-ai/daemon';
import type { PtyProcess } from '@jini-ai/platform';
import { expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';

const managers: TerminalSessionManager[] = [];
const child = { running: false };
const pty: PtyProcess = {
  onData() {}, onExit() {}, write() {}, resize() {},
  kill() { child.running = false; },
};

// Keep the real manager and session service; replace only the OS spawn boundary.
vi.mock('@jini-ai/daemon', async importOriginal => {
  const actual = await importOriginal<typeof import('@jini-ai/daemon')>();
  return {
    ...actual,
    createTerminalSessionManager: (...args: Parameters<typeof actual.createTerminalSessionManager>) => {
      const manager = actual.createTerminalSessionManager(args[0], { ...args[1], shutdownGraceMs: 0,
        loadSpawnPty: async () => () => { child.running = true; return pty; } });
      managers.push(manager);
      return manager;
    },
  };
});

it('P9: closing the kernel terminates PTYs owned by the terminal feature', async () => {
  vi.useFakeTimers();
  const app = express();
  installRouteRegistrationGuard({ app });
  let kernel: Awaited<ReturnType<typeof composeJiniKernel>> | undefined;
  try {
    kernel = await composeJiniKernel({
      app, adapter: { resolvedPortRef: { current: 0 }, env: {}, allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS',
        webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST' },
      security: { mode: 'host' }, storage: { kind: 'memory' }, profile: 'agent-core-v1',
      capabilities: { 'host:exec': true }, features: { terminal: true },
    });
    expect(managers).toHaveLength(1);
    const manager = managers[0]!;
    const principal = { id: 'terminal-owner' };
    const session = await manager.create({ principal, options: { cwd: '/fixture', shell: '/bin/sh' } });
    expect(child.running).toBe(true);
    expect(session.status).toBe('running');

    await kernel.close();

    expect(child.running).toBe(false);
    expect(manager.get({ principal, id: session.id })).toMatchObject({ status: 'ok', session: { status: 'exited' } });
  } finally {
    try {
      await kernel?.close();
      for (const manager of managers) await manager.shutdownActive({ graceMs: 0 });
    } finally {
      managers.length = 0;
      child.running = false;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }
});
