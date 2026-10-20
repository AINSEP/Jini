/**
 * Typed fake `ModelDiscoveryDeps` for driving a def's `discoverModels` port in its own test file,
 * so the def's `fallbackModels`/`parse` configuration lambdas are exercised through the real
 * discovery policy rather than called directly.
 */
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from '../../model-discovery-types.js';

export const discoveryContext: ModelDiscoveryContext = { executable: '/cli', version: '1', cwd: '/workspace', env: { HOME: '/home/fake' } };

/** Every probe fails (no CLI output, no files, no credentials) so discovery lands on the offline fallback. */
export function offlineDiscoveryDeps(): ModelDiscoveryDeps {
  const offline = new Error('offline');
  return {
    process: { async run() { throw offline; } },
    fs: { async read() { return null; } },
    http: { async list() { throw offline; } },
    credential: { async connection() { return null; } },
    acp: { async probe() { throw offline; } },
    rpc: { async probe() { throw offline; } },
    clock: { now: () => 0 },
    cache: new Map(),
  };
}

/** The CLI listing call prints `stdout`; every other probe behaves as offline. */
export function cliOutputDiscoveryDeps(stdout: string): ModelDiscoveryDeps {
  return { ...offlineDiscoveryDeps(), process: { async run() { return { stdout, stderr: '' }; } } };
}
