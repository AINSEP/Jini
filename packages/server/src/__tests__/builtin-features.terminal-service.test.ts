import express from 'express';
import { installRouteRegistrationGuard } from '@jini-ai/http-kit';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import type { CreateTerminalServiceOptions, PtySpawn, TerminalService } from '@jini-ai/core/contracts/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';

/**
 * @file R8a step 3 (R10): the preset builds the terminal service. Boot is inert unless the host
 * selects a PTY loader, a host loader wins over the inert one, and exactly the tuning the host gave
 * reaches the service (an explicit `undefined` never overrides an engine default).
 */

const built: Array<{ options: CreateTerminalServiceOptions; service: TerminalService }> = [];

// A recording spy over the real engine: records the options the preset hands `createTerminalService`, so knob forwarding is asserted, not assumed, and the service it gets back.
vi.mock('@jini-ai/platform', async importOriginal => {
  const actual = await importOriginal<typeof import('@jini-ai/platform')>();
  return {
    ...actual,
    createTerminalService: (...args: Parameters<typeof actual.createTerminalService>) => {
      const service = actual.createTerminalService(...args);
      built.push({ options: args[0], service });
      return service;
    },
  };
});

const kernels: Array<Awaited<ReturnType<typeof composeJiniKernel>>> = [];
afterEach(async () => {
  for (const kernel of kernels.splice(0)) await kernel.close();
  built.length = 0;
});

async function composeWith(terminal: Record<string, unknown> | undefined): Promise<void> {
  const app = express();
  installRouteRegistrationGuard({ app });
  kernels.push(await composeJiniKernel({
    app, adapter: createTestRouteHost(), resolvedPortRef: { current: 0 },
    security: { mode: 'host' }, storage: { kind: 'memory' }, profile: 'agent-core-v1',
    capabilities: { 'host:exec': true }, features: { terminal: true },
    ...(terminal === undefined ? {} : { featureOptions: { terminal } }),
  }));
}

describe('the preset builds the terminal service', () => {
  it('keeps boot inert: create() rejects with guidance naming the server adapter, and no PTY library is touched', async () => {
    await composeWith(undefined);
    expect(built).toHaveLength(1);
    await expect(built[0]!.service.create({ cwd: '/work' })).rejects.toThrow(
      'Interactive terminals require a host-supplied terminalService or loadSpawnPty. Import loadRealSpawnPty from @jini-ai/server/adapters/node-pty to enable node-pty.',
    );
  });

  it('uses the host loader instead of the inert one', async () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('host loader ran'); };
    await composeWith({ loadSpawnPty });
    expect(built[0]!.options.loadSpawnPty).toBe(loadSpawnPty);
    await expect(built[0]!.service.create({ cwd: '/work' })).rejects.toThrow('host loader ran');
  });

  it('forwards every tuning option that was given, and only those', async () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('unused'); };
    await composeWith({ loadSpawnPty, maxEvents: 1, maxBufferBytes: 2, exitTailBytes: 3, flushIntervalMs: 4, flushThresholdBytes: 5, ttlMs: 6, shutdownGraceMs: 7 });
    expect(built[0]!.options).toEqual({ loadSpawnPty, maxEvents: 1, maxBufferBytes: 2, exitTailBytes: 3, flushIntervalMs: 4, flushThresholdBytes: 5, ttlMs: 6, shutdownGraceMs: 7 });
  });

  it('leaves an omitted or undefined option out so the engine default applies', async () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('unused'); };
    await composeWith({ loadSpawnPty, maxEvents: 9, ttlMs: undefined });
    expect(Object.keys(built[0]!.options).sort()).toEqual(['loadSpawnPty', 'maxEvents']);
  });
});
