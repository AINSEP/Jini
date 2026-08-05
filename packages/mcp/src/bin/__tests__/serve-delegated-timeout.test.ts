import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked so the delegated tool's handler can be invoked without HTTP, and the deadline it was
// built with read straight off the call. `getDaemonJson` is stubbed too because other tool defs
// in the same server import it at module load; leaving it undefined would break the import graph
// rather than this one assertion.
const hoisted = vi.hoisted(() => ({
  postDaemonJson: vi.fn(),
  getDaemonJson: vi.fn(),
  DaemonResponseTooLargeError: class extends Error {},
}));
vi.mock('../../server/daemon-client.js', () => hoisted);

import type { McpToolDef } from '../../server/tool-protocol.js';
import type { McpToolServerHandle, McpToolServerOptions } from '../../server/tool-server.js';
import { DEFAULT_DELEGATED_TOOL_TIMEOUT_MS } from '../../server/tools/delegated-tool.js';
import { DELEGATED_TOOL_TIMEOUT_ENV_VAR, RUN_ID_ENV_VAR, serve, type ServeDeps } from '../serve.js';

const ctx = { baseUrl: 'http://d.example', fetchImpl: fetch };

beforeEach(() => {
  hoisted.postDaemonJson.mockReset();
});

/**
 * Boots `serve()` with the given env, then invokes the `execute_delegated_tool` def it registered
 * and returns the `timeoutMs` that reached the daemon client.
 *
 * Driving it through `serve()` rather than calling `createExecuteDelegatedToolTool` directly is
 * the whole point: this process is spawned as a subprocess by the daemon, so env is the only
 * channel a host has to reach the option. A unit test of the option alone would pass even if
 * `serve()` never read the variable.
 */
async function timeoutSeenVia(env: Record<string, string>): Promise<number | undefined> {
  let seen: McpToolServerOptions | undefined;
  const deps: ServeDeps = {
    env: { [RUN_ID_ENV_VAR]: 'run-1', ...env },
    writeErr: () => {},
    exit: (code: number): never => {
      throw new Error(`unexpected exit ${code}`);
    },
    // Cast through `unknown` rather than `ServeDeps['createMcpToolServer']`: that indexed type
    // includes `undefined` under `exactOptionalPropertyTypes`, which is not assignable back to the
    // property. Same pattern as `serve.test.ts`'s `castMcpToolServer`.
    createMcpToolServer: ((options: McpToolServerOptions): McpToolServerHandle => {
      seen = options;
      return { run: async () => {} };
    }) as unknown as (options: McpToolServerOptions) => McpToolServerHandle,
  };
  await serve(deps);

  const tool = seen?.tools.find((t: McpToolDef) => t.name === 'execute_delegated_tool');
  if (!tool) throw new Error('serve() registered no execute_delegated_tool def');

  hoisted.postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
  await tool.handler({ toolId: 't1' }, ctx);
  return ((hoisted.postDaemonJson.mock.calls[0] as unknown[])[3] as { timeoutMs?: number }).timeoutMs;
}

describe('JINI_DELEGATED_TOOL_TIMEOUT_MS (REF-002: the option must be reachable from the real spawn path)', () => {
  it('uses the default when the host sets nothing, preserving today behaviour exactly', async () => {
    expect(await timeoutSeenVia({})).toBe(DEFAULT_DELEGATED_TOOL_TIMEOUT_MS);
  });

  it('applies a host-supplied deadline from the environment', async () => {
    expect(await timeoutSeenVia({ [DELEGATED_TOOL_TIMEOUT_ENV_VAR]: '90000' })).toBe(90_000);
  });

  // Same posture as JINI_DAEMON_TOKEN: this process cannot observe the host policy that would make
  // a number correct, so a garbage value degrades to the default instead of refusing to boot — or,
  // worse, arming a 0 ms timer that fails every human-in-the-loop call instantly.
  it.each([
    ['a non-numeric value', 'six-minutes'],
    ['an empty string', ''],
    ['zero', '0'],
    ['a negative value', '-1'],
  ])('falls back to the default for %s rather than failing to boot', async (_label, raw) => {
    expect(await timeoutSeenVia({ [DELEGATED_TOOL_TIMEOUT_ENV_VAR]: raw })).toBe(
      DEFAULT_DELEGATED_TOOL_TIMEOUT_MS,
    );
  });
});
