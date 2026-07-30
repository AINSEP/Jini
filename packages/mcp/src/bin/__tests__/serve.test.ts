import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpToolServerHandle, McpToolServerOptions } from '../../server/tool-server.js';
import { DAEMON_TOKEN_ENV_VAR, DAEMON_URL_ENV_VAR, RUN_ID_ENV_VAR, serve, type ServeDeps } from '../serve.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function makeDeps(overrides: Partial<ServeDeps> = {}): ServeDeps & { errWritten: string[] } {
  const errWritten: string[] = [];
  const exit = (code: number): never => {
    throw new ExitSentinel(code);
  };
  return {
    env: { [RUN_ID_ENV_VAR]: 'run-1' },
    writeErr: (text: string) => {
      errWritten.push(text);
    },
    errWritten,
    exit,
    ...overrides,
  };
}

function castMcpToolServer(fn: (...args: any[]) => any): (options: McpToolServerOptions) => McpToolServerHandle {
  return fn as unknown as (options: McpToolServerOptions) => McpToolServerHandle;
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('serve() — wiring, with a fully-injected fake createMcpToolServer', () => {
  it('exits 1 without ever calling createMcpToolServer when JINI_RUN_ID is missing', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({ env: {}, createMcpToolServer: castMcpToolServer(createMcpToolServer) });
    await expect(serve(deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(deps.errWritten.join('')).toContain(RUN_ID_ENV_VAR);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });

  it('exits 1 without calling createMcpToolServer when JINI_RUN_ID is an empty string', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({
      env: { [RUN_ID_ENV_VAR]: '' },
      createMcpToolServer: castMcpToolServer(createMcpToolServer),
    });
    await expect(serve(deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });

  it('builds a tool list of RUN_TOOLS plus TOOL_CATALOG_TOOLS plus one execute_delegated_tool def, resources, name/version/instructions', async () => {
    let seenOptions: McpToolServerOptions | undefined;
    const fakeHandle: McpToolServerHandle = { run: async () => {} };
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seenOptions = options;
      return fakeHandle;
    });
    const deps = makeDeps({ createMcpToolServer });
    await serve(deps);
    expect(createMcpToolServer).toHaveBeenCalledTimes(1);
    expect(seenOptions?.name).toBe('jini-mcp');
    expect(seenOptions?.version).toEqual(expect.any(String));
    expect(seenOptions?.instructions).toContain('execute_delegated_tool');
    const toolNames = seenOptions?.tools.map((t) => t.name);
    expect(toolNames).toEqual([
      'start_run',
      'get_run',
      'cancel_run',
      'get_active_context',
      'list_agents',
      'search_tools',
      'describe_tool',
      'execute_delegated_tool',
    ]);
    expect(seenOptions?.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: 'jini://active' })]),
    );
  });

  it('omits fetchImpl/stdin/stdout from the built options entirely when not injected', async () => {
    let seenOptions: McpToolServerOptions | undefined;
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seenOptions = options;
      return { run: async () => {} };
    });
    await serve(makeDeps({ createMcpToolServer }));
    expect('fetchImpl' in (seenOptions as object)).toBe(false);
    expect('stdin' in (seenOptions as object)).toBe(false);
    expect('stdout' in (seenOptions as object)).toBe(false);
  });

  it('threads fetchImpl/stdin/stdout through to createMcpToolServer when injected', async () => {
    let seenOptions: McpToolServerOptions | undefined;
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seenOptions = options;
      return { run: async () => {} };
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    await serve(makeDeps({ createMcpToolServer, fetchImpl, stdin: stdin as any, stdout: stdout as any }));
    expect(seenOptions?.fetchImpl).toBe(fetchImpl);
    expect(seenOptions?.stdin).toBe(stdin);
    expect(seenOptions?.stdout).toBe(stdout);
  });

  it('threads a custom generateToolUseId into the execute_delegated_tool def', async () => {
    let seenOptions: McpToolServerOptions | undefined;
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seenOptions = options;
      return { run: async () => {} };
    });
    const postDaemonJsonCalls: unknown[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: { executionId: 'e1', status: 'completed' } }), { status: 200 })) as unknown as typeof fetch;
    await serve(makeDeps({ createMcpToolServer, fetchImpl, generateToolUseId: () => 'fixed-tool-use-id' }));
    const tool = seenOptions?.tools.find((t) => t.name === 'execute_delegated_tool');
    expect(tool).toBeDefined();
    await tool!.handler({ toolId: 'echo' }, { baseUrl: 'http://d.example', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://d.example/api/delegated-tool-calls',
      expect.objectContaining({ body: expect.stringContaining('"toolUseId":"fixed-tool-use-id"') }),
    );
    void postDaemonJsonCalls;
  });

  it('resolves the daemon base URL via resolveDaemonUrl, wired to JINI_DAEMON_URL and no CLI flag', async () => {
    let seenOptions: McpToolServerOptions | undefined;
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seenOptions = options;
      return { run: async () => {} };
    });
    const resolveDaemonUrl = vi.fn(async () => 'http://resolved.example');
    await serve(makeDeps({ createMcpToolServer, resolveDaemonUrl, env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_URL_ENV_VAR]: 'http://from-env.example' } }));
    const resolved = await seenOptions!.resolveBaseUrl();
    expect(resolved).toBe('http://resolved.example');
    expect(resolveDaemonUrl).toHaveBeenCalledWith({
      flagUrl: null,
      env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_URL_ENV_VAR]: 'http://from-env.example' },
      envVarName: DAEMON_URL_ENV_VAR,
      warn: expect.any(Function),
    });
  });

  it('writes an error and exits 1 when handle.run() rejects (e.g. resolveDaemonUrl throwing)', async () => {
    const createMcpToolServer = vi.fn(() => ({
      run: async () => {
        throw new Error('no daemon URL resolved');
      },
    }));
    const deps = makeDeps({ createMcpToolServer });
    await expect(serve(deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(deps.errWritten.join('')).toContain('no daemon URL resolved');
  });

  it('formats a non-Error throw from handle.run() via String()', async () => {
    const createMcpToolServer = vi.fn(() => ({
      run: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw string failure';
      },
    }));
    const deps = makeDeps({ createMcpToolServer });
    await expect(serve(deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(deps.errWritten.join('')).toContain('raw string failure');
  });
});

// ---------------------------------------------------------------------------
// Genuine end-to-end round trip: the real createMcpToolServer (default, not
// injected) + real @modelcontextprotocol/sdk Server/StdioServerTransport,
// driven by hand-crafted JSON-RPC frames over real in-memory PassThrough
// streams standing in for stdin/stdout — an in-process fake MCP client. Only
// the daemon-side HTTP call is faked (fetchImpl), proving the actual new
// code paths this task added: stdio -> MCP tool dispatch ->
// execute_delegated_tool -> daemon-client -> (fake) HTTP -> MCP response ->
// back out over stdout.
// ---------------------------------------------------------------------------
describe('serve() — real MCP round trip over in-memory stdio (no createMcpToolServer fake)', () => {
  it('a fake MCP client calling execute_delegated_tool receives the daemon-issued ToolExecutionResult back over stdout', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { body?: string }) => {
      fetchCalls.push({ url, body: init.body !== undefined ? JSON.parse(init.body) : undefined });
      return new Response(
        JSON.stringify({ result: { executionId: 'exec-1', status: 'completed', output: { echoed: { hi: true } } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const messages: unknown[] = [];
    let buffer = '';
    stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) messages.push(JSON.parse(line));
      }
    });

    const runPromise = serve({
      env: { [RUN_ID_ENV_VAR]: 'run-xyz', [DAEMON_URL_ENV_VAR]: 'http://daemon.example' },
      stdin: stdin as any,
      stdout: stdout as any,
      fetchImpl,
      generateToolUseId: () => 'tu-1',
    });
    await flushAsync();

    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fake-client', version: '0.0.0' } },
      })}\n`,
    );
    await vi.waitFor(() => {
      if (messages.length < 1) throw new Error('waiting for initialize response');
    });
    expect((messages[0] as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('jini-mcp');

    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'execute_delegated_tool', arguments: { toolId: 'echo', input: { hi: true } } },
      })}\n`,
    );
    await vi.waitFor(() => {
      if (messages.length < 2) throw new Error('waiting for tools/call response');
    });

    const callResponse = messages[1] as { id: number; result: { content: Array<{ type: string; text: string }> } };
    expect(callResponse.id).toBe(2);
    const resultPayload = JSON.parse(callResponse.result.content[0]!.text) as { status: string; output: unknown };
    expect(resultPayload).toEqual({ executionId: 'exec-1', status: 'completed', output: { echoed: { hi: true } } });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe('http://daemon.example/api/delegated-tool-calls');
    expect(fetchCalls[0]!.body).toEqual({ runId: 'run-xyz', toolUseId: 'tu-1', toolId: 'echo', input: { hi: true } });

    stdin.end();
    await expect(runPromise).resolves.toBeUndefined();
  });
});

// Mirrors packages/cli/src/__tests__/main.test.ts's identical "module top-level entrypoint
// guard" block for main.ts's own isMainModule check — same mechanism, same reason: the guard at
// the bottom of serve.ts is only ever `true` in a real `node dist/bin/serve.js` invocation, which
// a plain `import '../serve.js'` (every test above) never triggers. `vi.resetModules()` + a fresh
// dynamic `import('../serve.js')` after pointing `process.argv[1]` at the module's own resolved
// path is the only way to actually exercise that top-level branch. The "runs for real" case below
// deliberately drives the *missing-JINI_RUN_ID* path (not a full server run): every other path
// eventually calls the real, blocking `createMcpToolServer(...).run()` against real
// `process.stdin`/`process.stdout`, which would never resolve in a test process (nothing closes
// real stdin) — the missing-env-var path is the one exit that both completes immediately and
// exercises the real, undoctored `serve()` call the guard makes.
describe('module top-level entrypoint guard', () => {
  const originalArgv = process.argv;
  const hadRunId = RUN_ID_ENV_VAR in process.env;
  const originalRunId = process.env[RUN_ID_ENV_VAR];

  afterEach(() => {
    process.argv = originalArgv;
    if (hadRunId) {
      process.env[RUN_ID_ENV_VAR] = originalRunId;
    } else {
      delete process.env[RUN_ID_ENV_VAR];
    }
    vi.restoreAllMocks();
  });

  it('runs serve() for real when process.argv[1] matches this module\'s own resolved path', async () => {
    delete process.env[RUN_ID_ENV_VAR];
    const modulePath = fileURLToPath(new URL('../serve.ts', import.meta.url));
    process.argv = ['node', modulePath];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.resetModules();
    await import('../serve.js');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(RUN_ID_ENV_VAR));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not run serve() for real when process.argv[1] does not match (e.g. imported under a test runner)', async () => {
    process.argv = ['node', '/some/unrelated/path/not-serve.js'];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.resetModules();
    await import('../serve.js');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('does not run serve() for real when process.argv[1] is undefined', async () => {
    process.argv = ['node'];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.resetModules();
    await import('../serve.js');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe('serve() — daemon credential propagation', () => {
  function captureOptions() {
    let seen: McpToolServerOptions | undefined;
    const createMcpToolServer = vi.fn((options: McpToolServerOptions) => {
      seen = options;
      return { run: async () => {} } as McpToolServerHandle;
    });
    return { createMcpToolServer, seenOptions: () => seen };
  }

  it('turns JINI_DAEMON_TOKEN into an Authorization header for every tool call', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve(
      makeDeps({
        env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_TOKEN_ENV_VAR]: 'run-scoped-secret' },
        createMcpToolServer,
      }),
    );
    expect(seenOptions()?.authHeaders).toEqual({ Authorization: 'Bearer run-scoped-secret' });
  });

  // Optional, unlike JINI_RUN_ID: a daemon that trusts loopback issues no credential, and this
  // process must keep serving it exactly as before rather than refusing to boot.
  it('omits authHeaders entirely when no credential was delivered', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve(makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run-1' }, createMcpToolServer }));
    expect(seenOptions()).not.toHaveProperty('authHeaders');
  });

  it('treats an empty credential as absent rather than sending "Bearer "', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve(
      makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_TOKEN_ENV_VAR]: '' }, createMcpToolServer }),
    );
    expect(seenOptions()).not.toHaveProperty('authHeaders');
  });

  it('still requires JINI_RUN_ID even when a credential is present', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({
      env: { [DAEMON_TOKEN_ENV_VAR]: 'run-scoped-secret' },
      createMcpToolServer: castMcpToolServer(createMcpToolServer),
    });
    await expect(serve(deps)).rejects.toThrow(ExitSentinel);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });
});
