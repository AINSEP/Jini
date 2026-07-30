import { describe, expect, it } from 'vitest';
import { createExecuteDelegatedToolTool } from '../tools/delegated-tool.js';
import { RUN_TOOLS } from '../tools/run-tools.js';
import { TOOL_CATALOG_TOOLS } from '../tools/tool-catalog-tools.js';
import { KERNEL_RESOURCES } from '../resources/active-resource.js';
import { daemonCallOptions, type McpToolContext } from '../tool-protocol.js';

/**
 * Every tool and resource this package hosts must carry the daemon credential on its callbacks.
 *
 * This is an aggregate test on purpose. The failure it guards against is not "the mechanism doesn't
 * work" — a single happy-path test on one tool proves that — but "the mechanism was wired into some
 * call sites and not others", which presents to a user as a coding agent being offered tools that
 * silently 401 while its neighbours work. Enumerating the real registries means a newly added tool
 * that forgets `daemonCallOptions` fails here rather than in production.
 */

/** Records the headers each daemon call was made with. */
function makeSpyFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      text: async () => '{}',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Superset of every argument any hosted tool requires, so each handler reaches its daemon call. */
const PERMISSIVE_ARGS = {
  contextRef: 'ctx-1',
  runId: 'run-1',
  query: 'anything',
  id: 'some.tool',
  toolId: 'some.tool',
  input: {},
} as const;

const ALL_TOOLS = [
  ...RUN_TOOLS,
  ...TOOL_CATALOG_TOOLS,
  createExecuteDelegatedToolTool({ runId: 'run-1', generateToolUseId: () => 'tu-1' }),
];

describe('daemon credential propagation', () => {
  // Sanity check on the enumeration itself: if a registry is ever emptied or renamed, the loops below
  // would vacuously pass. 8 tools + 1 resource is the current real surface.
  it('enumerates the full hosted surface', () => {
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual([
      'cancel_run',
      'describe_tool',
      'execute_delegated_tool',
      'get_active_context',
      'get_run',
      'list_agents',
      'search_tools',
      'start_run',
    ]);
    expect(KERNEL_RESOURCES).toHaveLength(1);
  });

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    'tool %s sends the Authorization header',
    async (_name, tool) => {
      const { calls, fetchImpl } = makeSpyFetch();
      const ctx: McpToolContext = {
        baseUrl: 'http://d.example',
        fetchImpl,
        authHeaders: { Authorization: 'Bearer run-scoped-secret' },
      };
      await tool.handler(PERMISSIVE_ARGS as never, ctx);
      expect(calls).not.toHaveLength(0);
      for (const call of calls) {
        expect(call.headers.Authorization, `${_name} -> ${call.url}`).toBe('Bearer run-scoped-secret');
      }
    },
  );

  it.each(KERNEL_RESOURCES.map((resource) => [resource.uri, resource] as const))(
    'resource %s sends the Authorization header',
    async (uri, resource) => {
      const { calls, fetchImpl } = makeSpyFetch();
      const ctx: McpToolContext = {
        baseUrl: 'http://d.example',
        fetchImpl,
        authHeaders: { Authorization: 'Bearer run-scoped-secret' },
      };
      await resource.read(ctx);
      expect(calls).not.toHaveLength(0);
      for (const call of calls) {
        expect(call.headers.Authorization, `${uri} -> ${call.url}`).toBe('Bearer run-scoped-secret');
      }
    },
  );

  // The additive guarantee: with no credential, requests carry no Authorization header at all — not
  // an empty or `Bearer undefined` one, which a daemon would reject rather than ignore.
  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    'tool %s sends no Authorization header when no credential was issued',
    async (_name, tool) => {
      const { calls, fetchImpl } = makeSpyFetch();
      await tool.handler(PERMISSIVE_ARGS as never, { baseUrl: 'http://d.example', fetchImpl });
      expect(calls).not.toHaveLength(0);
      for (const call of calls) {
        expect(call.headers).not.toHaveProperty('Authorization');
      }
    },
  );
});

describe('daemonCallOptions', () => {
  const fetchImpl = (async () => new Response('{}')) as unknown as typeof fetch;

  it('omits headers entirely when the context carries no auth headers', () => {
    expect(daemonCallOptions({ baseUrl: 'http://d.example', fetchImpl })).toEqual({ fetchImpl });
  });

  it('passes through the auth headers when present', () => {
    expect(
      daemonCallOptions({ baseUrl: 'http://d.example', fetchImpl, authHeaders: { Authorization: 'Bearer x' } }),
    ).toEqual({ fetchImpl, headers: { Authorization: 'Bearer x' } });
  });

  // Copied, not aliased: a handler mutating its own options object must not corrupt the shared
  // per-process context every later tool call reads from.
  it('copies the header map rather than aliasing the context', () => {
    const authHeaders = { Authorization: 'Bearer x' };
    const options = daemonCallOptions({ baseUrl: 'http://d.example', fetchImpl, authHeaders });
    options.headers!.Authorization = 'Bearer mutated';
    expect(authHeaders.Authorization).toBe('Bearer x');
  });
});
