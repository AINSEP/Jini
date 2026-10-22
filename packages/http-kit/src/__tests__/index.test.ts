import { describe, expect, it } from 'vitest';
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
    expect(HttpBarrel.isLoopbackHostname({ hostname })).toBe(expected);
  });

  it('re-exports the Result helpers', () => {
    expect(typeof HttpBarrel.ok).toBe('function');
    expect(typeof HttpBarrel.err).toBe('function');
  });

  it('re-exports the origin-validation predicates, including the same-origin guard', () => {
    expect(typeof HttpBarrel.isLocalSameOrigin).toBe('function');
    expect(typeof HttpBarrel.isAllowedBrowserOrigin).toBe('function');
    expect(typeof HttpBarrel.allowedBrowserPorts).toBe('function');
    expect(typeof HttpBarrel.configuredAllowedOrigins).toBe('function');
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
    expect(HttpBarrel.DEFAULT_MAX_QUEUED_SSE_EVENTS).toBe(1000);
  });

  it('re-exports the raw SSE primitive used by run-stream mounting (a distinct mechanism from createSseChannel)', () => {
    expect(typeof HttpBarrel.createSseResponse).toBe('function');
  });

});
