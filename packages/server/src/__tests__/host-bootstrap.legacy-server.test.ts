import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { CAPABILITY_IDS, CORE_CAPABILITIES, isCapabilityId } from '../feature.js';
import { closeHttpServer } from '../host-bootstrap.js';

/** A server object without Node 18.2+'s closeIdleConnections/closeAllConnections must still close
 *  (optional calls, L9 §4 host-bootstrap), and the capability vocabulary is pinned (AP6). */
describe('closeHttpServer on a server lacking the connection-closing methods', () => {
  it('resolves at the hard deadline when close() never calls back', async () => {
    const server = { listening: true, close: vi.fn() } as unknown as Server;
    await expect(closeHttpServer(server, { closeTimeoutMs: 20, idleCloseMs: 5 })).resolves.toBeUndefined();
    expect(server.close).toHaveBeenCalledOnce();
  });
  it('resolves on a clean close callback and rejects with the callback error', async () => {
    const ok = { listening: true, close: (cb: (error?: Error) => void) => cb() } as unknown as Server;
    await expect(closeHttpServer(ok, { closeTimeoutMs: 1000 })).resolves.toBeUndefined();
    const failure = new Error('ERR_SERVER_NOT_RUNNING');
    const bad = { listening: true, close: (cb: (error?: Error) => void) => cb(failure) } as unknown as Server;
    await expect(closeHttpServer(bad, { closeTimeoutMs: 1000 })).rejects.toBe(failure);
  });
  it('does not touch a server that is not listening', async () => {
    const server = { listening: false, close: vi.fn(), closeAllConnections: vi.fn(), closeIdleConnections: vi.fn() } as unknown as Server;
    await closeHttpServer(server);
    expect(server.close).not.toHaveBeenCalled();
    expect(server.closeIdleConnections).not.toHaveBeenCalled();
  });
  it('force-closes all connections at the deadline when the methods exist', async () => {
    const server = { listening: true, close: vi.fn(), closeAllConnections: vi.fn(), closeIdleConnections: vi.fn() } as unknown as Server;
    await closeHttpServer(server, { closeTimeoutMs: 20, idleCloseMs: 5 });
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalled();
  });
});

describe('capability vocabulary', () => {
  it('pins the full id list and the core-only ceiling', () => {
    expect([...CAPABILITY_IDS]).toEqual(['run:transport', 'run:inject', 'agent:discovery', 'tool:delegated', 'tool:catalog', 'host:read', 'host:exec', 'db:admin', 'net:egress', 'daemon:control', 'memory:store', 'routines:schedule', 'media:generate', 'ui:session']);
    expect([...CORE_CAPABILITIES]).toEqual(['run:transport', 'agent:discovery', 'tool:delegated']);
    expect(Object.isFrozen(CAPABILITY_IDS)).toBe(true);
    expect(Object.isFrozen(CORE_CAPABILITIES)).toBe(true);
  });
  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty', 'host:EXEC', 'host:exec ', ' host:exec', 'host', ''])('isCapabilityId refuses %j', (value) => {
    expect(isCapabilityId({ value })).toBe(false);
  });
  it.each(['host:exec', 'ui:session'])('isCapabilityId accepts %j', (value) => {
    expect(isCapabilityId({ value })).toBe(true);
  });
});
