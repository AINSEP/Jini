import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveJiniMcpBridge } from './mcp-bridge.js';

const REPO_ROOT = '/repo';
const BIN_PATH = join(REPO_ROOT, 'packages/mcp/dist/bin/serve.js');

function options(overrides: Partial<Parameters<typeof resolveJiniMcpBridge>[0]> = {}) {
  return {
    repoRoot: REPO_ROOT,
    daemonUrl: 'http://127.0.0.1:4317',
    nodePath: '/usr/local/bin/node',
    fileExists: () => true,
    join,
    ...overrides,
  };
}

describe('resolveJiniMcpBridge', () => {
  it('probes the @jini-ai/mcp build output under the repo root', () => {
    const probed: string[] = [];
    resolveJiniMcpBridge(
      options({
        fileExists: (path) => {
          probed.push(path);
          return true;
        },
      }),
    );
    expect(probed).toEqual([BIN_PATH]);
  });

  it('launches the bin through the given interpreter, by absolute path, so no PATH or exec bit is involved', () => {
    const resolution = resolveJiniMcpBridge(options());
    expect(resolution).toEqual({
      ok: true,
      injection: {
        command: '/usr/local/bin/node',
        args: [BIN_PATH],
        daemonUrl: 'http://127.0.0.1:4317',
      },
    });
  });

  it('carries the caller-supplied daemon URL through unchanged', () => {
    const resolution = resolveJiniMcpBridge(options({ daemonUrl: 'http://127.0.0.1:9999' }));
    expect(resolution.ok && resolution.injection.daemonUrl).toBe('http://127.0.0.1:9999');
  });

  it('reports the exact missing path when @jini-ai/mcp has not been built', () => {
    const resolution = resolveJiniMcpBridge(options({ fileExists: () => false }));
    expect(resolution).toEqual({ ok: false, missingPath: BIN_PATH });
  });
});
