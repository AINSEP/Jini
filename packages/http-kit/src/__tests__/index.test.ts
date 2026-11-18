import { describe, expect, it } from 'vitest';
import * as CoreRoot from '@jini-ai/core';
import * as CoreNet from '@jini-ai/core/net';
import * as CoreServer from '@jini-ai/core/contracts/server';
import * as HttpBarrel from '../index.js';

/**
 * A barrel-only smoke test: every other test in this package imports its target
 * module directly, so the root barrel itself was never actually exercised.
 * Proves the public surface a host actually imports (`from '@jini-ai/http-kit'`) really
 * re-exports what `archived provenance ledger` documents.
 */
describe('@jini-ai/http-kit barrel', () => {
  // PARITY: hosts retain the public hostname predicate after its implementation is consolidated.
  it.each([
    ['localhost', true],
    ['LOCALHOST.', true],
    ['127.5.6.7', true],
    ['[::1]', true],
    ['0:0:0:0:0:0:0:1', true],
    ['::ffff:127.0.0.1', false],
    ['localhost.evil.example', false],
    ['10.0.0.1', false],
    ['', false],
  ])('preserves the public loopback hostname result for %s', (hostname, expected) => {
    expect(CoreNet.isLoopbackHostname({ hostname })).toBe(expected);
  });

  // No shells: names that moved to core are imported from core, never re-exported here.
  it('leaves the moved Result helpers, origin predicates, loopback predicate and SSE cap to core', () => {
    const moved = ['isLoopbackHostname', 'ok', 'err', 'isLocalSameOrigin', 'isAllowedBrowserOrigin', 'allowedBrowserPorts', 'configuredAllowedOrigins', 'DEFAULT_MAX_QUEUED_SSE_EVENTS'];
    expect(moved.filter((name) => name in HttpBarrel)).toEqual([]);
  });

  it('the Result helpers live in core/contracts/server', () => {
    expect(typeof CoreServer.ok).toBe('function');
    expect(typeof CoreServer.err).toBe('function');
  });

  it('the origin-validation predicates, including the same-origin guard, live in core', () => {
    expect(typeof CoreRoot.isLocalSameOrigin).toBe('function');
    expect(typeof CoreRoot.isAllowedBrowserOrigin).toBe('function');
    expect(typeof CoreRoot.allowedBrowserPorts).toBe('function');
    expect(typeof CoreRoot.configuredAllowedOrigins).toBe('function');
  });

  it('re-exports the pack-http registrar', () => {
    expect(typeof HttpBarrel.mountPackHttp).toBe('function');
  });

  it('re-exports the compat error helpers', () => {
    expect(typeof HttpBarrel.createCompatApiError).toBe('function');
    expect(typeof HttpBarrel.createCompatApiErrorResponse).toBe('function');
    expect(typeof HttpBarrel.sendApiError).toBe('function');
  });

  it('re-exports the Express-mounting Adapter and security middleware flat at the root', () => {
    expect(typeof HttpBarrel.mountJsonRoute).toBe('function');
    expect(typeof HttpBarrel.registerApiBearerAuthMiddleware).toBe('function');
  });

  it('re-exports the generic SSE primitive', () => {
    expect(typeof HttpBarrel.createSseChannel).toBe('function');
    expect(typeof HttpBarrel.requestedAfterCursor).toBe('function');
    expect(typeof HttpBarrel.sendRawApiError).toBe('function');
    expect(CoreServer.DEFAULT_MAX_QUEUED_SSE_EVENTS).toBe(1000);
  });
});
