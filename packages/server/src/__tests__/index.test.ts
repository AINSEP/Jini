import { describe, expect, it } from 'vitest';
import * as NodeHostBarrel from '../index.js';

/**
 * A barrel-only smoke test: every other test in this package imports its target module directly,
 * so the root barrel itself was never actually exercised. Proves the public surface a real host
 * actually imports (`from '@jini-ai/server'`) really re-exports what this package's docs promise.
 */
describe('@jini-ai/server barrel', () => {
  it('re-exports createLocalNodeDaemon', () => {
    expect(typeof NodeHostBarrel.createLocalNodeDaemon).toBe('function');
  });

  it('re-exports the listen-tail pure helpers', () => {
    expect(typeof NodeHostBarrel.resolveBoundPort).toBe('function');
    expect(typeof NodeHostBarrel.resolveReportHost).toBe('function');
  });

  it('re-exports the host-bootstrap primitives', () => {
    expect(typeof NodeHostBarrel.closeHttpServer).toBe('function');
    expect(typeof NodeHostBarrel.normalizeDaemonBindHost).toBe('function');
    expect(NodeHostBarrel.DEFAULT_DAEMON_BIND_HOST).toBe('127.0.0.1');
  });
});
