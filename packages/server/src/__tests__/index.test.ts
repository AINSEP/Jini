import { readFileSync } from 'node:fs';
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
  // The frontend-control factory is owned by `@jini-ai/daemon/http`: the preset is wiring only and
  // must not re-export another package's API (a host that wants it imports it from the owner).
  it('exports exactly the preset-owned runtime values, listed here', () => {
    expect(Object.keys(NodeHostBarrel).sort()).toEqual([
      'ANONYMOUS_DELEGATED_PRINCIPAL',
      'CAPABILITY_IDS',
      'CORE_CAPABILITIES',
      'DEFAULT_DAEMON_BIND_HOST',
      'JINI_PROFILES',
      'LOCAL_DAEMON_PRINCIPAL',
      'buildDaemonDbOperations',
      'classifyRunFailureForRetry',
      'closeHttpServer',
      'composeJiniKernel',
      'createBuiltInFeatures',
      'createJiniKernelBase',
      'createLocalNodeDaemon',
      'defaultServerMessages',
      'defineJiniFeature',
      'installGracefulShutdown',
      'isCapabilityId',
      'mountRoutes',
      'nodeSessionTimer',
      'normalizeDaemonBindHost',
      'projectDetectedAgent',
      'resolveBoundPort',
      'resolveFeatureActivation',
      'resolveReportHost',
    ]);
  });

  it('does not re-export createFrontendControl or its types from the daemon HTTP surface', () => {
    expect('createFrontendControl' in NodeHostBarrel).toBe(false);
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/FrontendControl|FrontendBindErrorContext|FrontendHttpExtension/);
    expect(source).not.toMatch(/from\s+['"]@jini-ai\/daemon\/http['"]/);
  });
});
