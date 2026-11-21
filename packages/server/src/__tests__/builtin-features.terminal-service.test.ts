import type { CreateTerminalServiceOptions, PtySpawn, TerminalService } from '@jini-ai/core/contracts/runtime';
import { createTerminalService } from '@jini-ai/platform';
import { describe, expect, it } from 'vitest';
import { buildTerminalService, type TerminalFeatureOptions } from '../terminal-service.js';

/**
 * @file R8a step 3 (R10): the preset builds the terminal service. Boot is inert unless the host
 * selects a PTY loader, a host loader wins over the inert one, a service the host built is used as
 * given, and exactly the tuning the host gave reaches the service (an explicit `undefined` never
 * overrides an engine default). The builder is called directly with a recording `createService`:
 * no module is mocked.
 */

/** A `createService` that records the options the preset hands the engine (so knob forwarding is asserted, not assumed) and returns the real service it builds. */
function recordingBuilder(): { createService: typeof createTerminalService; built: CreateTerminalServiceOptions[] } {
  const built: CreateTerminalServiceOptions[] = [];
  return { built, createService: (options) => { built.push(options); return createTerminalService(options); } };
}

describe('the preset builds the terminal service', () => {
  it('keeps boot inert: create() rejects with guidance naming the server adapter, and no PTY library is touched', async () => {
    const service = buildTerminalService({ options: {} });
    await expect(service.create({ cwd: '/work' })).rejects.toThrow(
      'Interactive terminals require a host-supplied terminalService or loadSpawnPty. Import loadRealSpawnPty from @jini-ai/server/adapters/node-pty to enable node-pty.',
    );
  });

  it('uses the host loader instead of the inert one', async () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('host loader ran'); };
    const { createService, built } = recordingBuilder();
    const service = buildTerminalService({ options: { loadSpawnPty } }, { createService });
    expect(built[0]!.loadSpawnPty).toBe(loadSpawnPty);
    await expect(service.create({ cwd: '/work' })).rejects.toThrow('host loader ran');
  });

  it('uses a service the host built as given, without building another', () => {
    const hostService = { marker: 'host-built' } as unknown as TerminalService;
    const { createService, built } = recordingBuilder();
    expect(buildTerminalService({ options: { terminalService: hostService, loadSpawnPty: async () => { throw new Error('unused'); } } }, { createService })).toBe(hostService);
    expect(built).toEqual([]);
  });

  it('forwards every tuning option that was given, and only those', () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('unused'); };
    const { createService, built } = recordingBuilder();
    buildTerminalService({ options: { loadSpawnPty, maxEvents: 1, maxBufferBytes: 2, exitTailBytes: 3, flushIntervalMs: 4, flushThresholdBytes: 5, ttlMs: 6, shutdownGraceMs: 7 } }, { createService });
    expect(built[0]).toEqual({ loadSpawnPty, maxEvents: 1, maxBufferBytes: 2, exitTailBytes: 3, flushIntervalMs: 4, flushThresholdBytes: 5, ttlMs: 6, shutdownGraceMs: 7 });
  });

  it('leaves an omitted or undefined option out so the engine default applies', () => {
    const loadSpawnPty = async (): Promise<PtySpawn> => { throw new Error('unused'); };
    const { createService, built } = recordingBuilder();
    // A JavaScript host is not held to `exactOptionalPropertyTypes`: an explicit `undefined` must not override a default.
    const options = { loadSpawnPty, maxEvents: 9, ttlMs: undefined } as unknown as TerminalFeatureOptions;
    buildTerminalService({ options }, { createService });
    expect(Object.keys(built[0]!).sort()).toEqual(['loadSpawnPty', 'maxEvents']);
  });
});
