import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { CallToolResult, InitializeResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistry } from '@jini-ai/core';
// The existing daemon owners exercise confirmation without a listener or a new execution path.
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor } from '../../../../daemon/dist/index.js';
import { delegatedToolExecuteRoute } from '../../../../daemon/dist/http/delegated-tools.js';
import { createMcpToolServer, type McpToolServerHandle, type McpToolServerRequiredArgs, type McpToolServerOptions } from '../../server/tool-server.js';
import { DAEMON_TOKEN_ENV_VAR, DAEMON_URL_ENV_VAR, RUN_ID_ENV_VAR, STARTUP_TOOL_IDS_ENV_VAR, serve, type ServeDeps } from '../serve.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function makeDeps(overrides: Partial<ServeDeps> = {}): ServeDeps & { errWritten: string[] } {
  const errWritten: string[] = [];
  const exit = ({ code }: { code: number }): never => {
    throw new ExitSentinel(code);
  };
  return {
    env: { [RUN_ID_ENV_VAR]: 'run-1' },
    writeErr: ({ text }: { text: string }) => {
      errWritten.push(text);
    },
    errWritten,
    exit,
    ...overrides,
  };
}

function castMcpToolServer(fn: (...args: any[]) => any): (requiredArgs: McpToolServerRequiredArgs, optionalArgs?: McpToolServerOptions) => McpToolServerHandle {
  return fn as unknown as (requiredArgs: McpToolServerRequiredArgs, optionalArgs?: McpToolServerOptions) => McpToolServerHandle;
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('serve() — wiring, with a fully-injected fake createMcpToolServer', () => {
  it('carries trusted launch IDs into the server and daemon-client sanitizer', async () => {
    const { daemonCallOptions } = await import('../../server/tool-protocol.js');
    const { getDaemonJson } = await import('../../server/daemon-client.js');
    const diagnosticToolIds = ['forms_create_definition', 'source_control_get_capabilities'];
    const message = diagnosticToolIds.join('; ');
    let diagnostic = '';
    await serve({}, makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run-1', JINI_DIAGNOSTIC_TOOL_IDS: JSON.stringify(diagnosticToolIds) },
      createMcpToolServer: (_required, options) => ({ run: async () => {
        const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { message } }), { status: 400 });
        const error = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, daemonCallOptions({ ctx: {
          baseUrl: 'http://d.example', fetchImpl, ...(options?.diagnosticToolIds ? { diagnosticToolIds: options.diagnosticToolIds } : {}),
        } })).catch((error: Error) => error) as Error;
        diagnostic = error.message;
      } }),
    }));
    expect(diagnostic).toBe(`HTTP 400: ${message}`);
  });

  it('exits 1 without ever calling createMcpToolServer when JINI_RUN_ID is missing', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({ env: {}, createMcpToolServer: castMcpToolServer(createMcpToolServer) });
    await expect(serve({}, deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(deps.errWritten.join('')).toContain(RUN_ID_ENV_VAR);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });

  it('exits 1 without calling createMcpToolServer when JINI_RUN_ID is an empty string', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({
      env: { [RUN_ID_ENV_VAR]: '' },
      createMcpToolServer: castMcpToolServer(createMcpToolServer),
    });
    await expect(serve({}, deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });

  it('builds a tool list of RUN_TOOLS plus TOOL_CATALOG_TOOLS plus COMPONENT_CATALOG_TOOLS plus one execute_delegated_tool def, resources, name/version/instructions', async () => {
    let seenOptions: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const fakeHandle: McpToolServerHandle = { run: async () => {} };
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seenOptions = options;
      return fakeHandle;
    });
    const deps = makeDeps({ createMcpToolServer });
    await serve({}, deps);
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
      'search_components',
      'describe_component',
      'execute_delegated_tool',
      // Hosted alongside, never instead of: a client that auto-denies any tool lacking
      // `readOnlyHint: true` gets a reachable read half, and every other client still sees both.
      'execute_readonly_delegated_tool',
    ]);
    const readonlyGateway = seenOptions?.tools.find((t) => t.name === 'execute_readonly_delegated_tool');
    expect(readonlyGateway?.annotations).toMatchObject({ readOnlyHint: true });
    expect(seenOptions?.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: 'jini://active' }), expect.objectContaining({ uri: 'jini://site-guide' })]),
    );
    expect(seenOptions?.instructions).toContain('When the host provides site_guide');
    expect(seenOptions?.instructions).not.toContain('Before planning or building a site');
  });

  it('omits fetchImpl/stdin/stdout from the built options entirely when not injected', async () => {
    let seenOptions: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seenOptions = options;
      return { run: async () => {} };
    });
    await serve({}, makeDeps({ createMcpToolServer }));
    expect('fetchImpl' in (seenOptions as object)).toBe(false);
    expect('stdin' in (seenOptions as object)).toBe(false);
    expect('stdout' in (seenOptions as object)).toBe(false);
  });

  it('threads fetchImpl/stdin/stdout through to createMcpToolServer when injected', async () => {
    let seenOptions: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seenOptions = options;
      return { run: async () => {} };
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    await serve({}, makeDeps({ createMcpToolServer, fetchImpl, stdin: stdin as any, stdout: stdout as any }));
    expect(seenOptions?.fetchImpl).toBe(fetchImpl);
    expect(seenOptions?.stdin).toBe(stdin);
    expect(seenOptions?.stdout).toBe(stdout);
  });

  it('threads a custom generateToolUseId into the execute_delegated_tool def', async () => {
    let seenOptions: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seenOptions = options;
      return { run: async () => {} };
    });
    const postDaemonJsonCalls: unknown[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: { executionId: 'e1', status: 'completed' } }), { status: 200 })) as unknown as typeof fetch;
    await serve({}, makeDeps({ createMcpToolServer, fetchImpl, generateToolUseId: () => 'fixed-tool-use-id' }));
    const tool = seenOptions?.tools.find((t) => t.name === 'execute_delegated_tool');
    expect(tool).toBeDefined();
    await tool!.handler({ args: { toolId: 'echo' }, ctx: { baseUrl: 'http://d.example', fetchImpl } });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://d.example/api/delegated-tool-calls',
      expect.objectContaining({ body: expect.stringContaining('"toolUseId":"fixed-tool-use-id"') }),
    );
    void postDaemonJsonCalls;
  });

  it('resolves the daemon base URL via resolveDaemonUrl, wired to JINI_DAEMON_URL and no CLI flag', async () => {
    let seenOptions: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seenOptions = options;
      return { run: async () => {} };
    });
    const resolveDaemonUrl = vi.fn(async () => 'http://resolved.example');
    await serve({}, makeDeps({ createMcpToolServer, resolveDaemonUrl, env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_URL_ENV_VAR]: 'http://from-env.example' } }));
    const resolved = await seenOptions!.resolveBaseUrl();
    expect(resolved).toBe('http://resolved.example');
    expect(resolveDaemonUrl).toHaveBeenCalledWith({}, {
      flagUrl: null,
      env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_URL_ENV_VAR]: 'http://from-env.example' },
      envVarName: DAEMON_URL_ENV_VAR,
      warn: expect.any(Function),
    });
  });

  it('writes an error and exits 1 when handle.run({}) rejects (e.g. resolveDaemonUrl throwing)', async () => {
    const createMcpToolServer = vi.fn(() => ({
      run: async () => {
        throw new Error('no daemon URL resolved');
      },
    }));
    const deps = makeDeps({ createMcpToolServer });
    await expect(serve({}, deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(deps.errWritten.join('')).toContain('no daemon URL resolved');
  });

  it('formats a non-Error throw from handle.run({}) via String()', async () => {
    const createMcpToolServer = vi.fn(() => ({
      run: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'raw string failure';
      },
    }));
    const deps = makeDeps({ createMcpToolServer });
    await expect(serve({}, deps)).rejects.toBeInstanceOf(ExitSentinel);
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

    const runPromise = serve({}, {
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
// eventually calls the real, blocking `createMcpToolServer(...).run({})` against real
// `process.stdin`/`process.stdout`, which would never resolve in a test process (nothing closes
// real stdin) — the missing-env-var path is the one exit that both completes immediately and
// exercises the real, undoctored `serve({})` call the guard makes.
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
    let seen: (McpToolServerRequiredArgs & McpToolServerOptions) | undefined;
    const createMcpToolServer = vi.fn((requiredArgs: McpToolServerRequiredArgs, optionalArgs: McpToolServerOptions = {}) => {
      const options = { ...requiredArgs, ...optionalArgs };
      seen = options;
      return { run: async () => {} } as McpToolServerHandle;
    });
    return { createMcpToolServer, seenOptions: () => seen };
  }

  it('turns JINI_DAEMON_TOKEN into an Authorization header for every tool call', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve({}, makeDeps({
        env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_TOKEN_ENV_VAR]: 'run-scoped-secret' },
        createMcpToolServer,
      })
    );
    expect(seenOptions()?.authHeaders).toEqual({ Authorization: 'Bearer run-scoped-secret' });
  });

  // Optional, unlike JINI_RUN_ID: a daemon that trusts loopback issues no credential, and this
  // process must keep serving it exactly as before rather than refusing to boot.
  it('omits authHeaders entirely when no credential was delivered', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve({}, makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run-1' }, createMcpToolServer }));
    expect(seenOptions()).not.toHaveProperty('authHeaders');
  });

  it('treats an empty credential as absent rather than sending "Bearer "', async () => {
    const { createMcpToolServer, seenOptions } = captureOptions();
    await serve({}, makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run-1', [DAEMON_TOKEN_ENV_VAR]: '' }, createMcpToolServer })
    );
    expect(seenOptions()).not.toHaveProperty('authHeaders');
  });

  it('still requires JINI_RUN_ID even when a credential is present', async () => {
    const createMcpToolServer = vi.fn();
    const deps = makeDeps({
      env: { [DAEMON_TOKEN_ENV_VAR]: 'run-scoped-secret' },
      createMcpToolServer: castMcpToolServer(createMcpToolServer),
    });
    await expect(serve({}, deps)).rejects.toThrow(ExitSentinel);
    expect(createMcpToolServer).not.toHaveBeenCalled();
  });
});

// PARITY: executable assembly still resolves the host env once and redacts userinfo in warnings.
it('resolves the daemon URL without a CLI dependency and keeps warning credentials private', async () => {
  const errors: string[] = [];
  let resolved: string | undefined;
  await serve({}, { env: { [RUN_ID_ENV_VAR]: 'run', [DAEMON_URL_ENV_VAR]: 'http://user:secret@example.com:4111' },
    writeErr: ({ text }) => { errors.push(text); },
    exit: () => { throw new Error('unexpected exit'); },
    createMcpToolServer: required => ({ run: async () => { resolved = await required.resolveBaseUrl(); } }),
  });
  expect(resolved).toBe('http://user:secret@example.com:4111');
  expect(errors).toEqual(['daemon URL http://example.com:4111/ is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.']);
});
// PARITY: a run child has no discovery or default port when its spawning host omitted the URL.
it('reports the existing unresolved URL error through the executable boundary', async () => {
  const errors: string[] = [];
  await expect(serve({}, { env: { [RUN_ID_ENV_VAR]: 'run' }, writeErr: ({ text }) => { errors.push(text); },
    exit: () => { throw new Error('exit 1'); },
    createMcpToolServer: required => ({ run: async () => { await required.resolveBaseUrl(); } }),
  })).rejects.toThrow('exit 1');
  expect(errors).toEqual(['jini-mcp: no daemon URL resolved: JINI_DAEMON_URL is unset or empty; the spawning Jini daemon must set it to its HTTP base URL.\n']);
});

describe('serve() — characterization pins (before refactor)', () => {
  function captureOptions(env: NodeJS.ProcessEnv): { deps: ServeDeps & { errWritten: string[] }; seen: { options?: McpToolServerOptions } } {
    const seen: { options?: McpToolServerOptions } = {};
    const deps = makeDeps({
      env,
      createMcpToolServer: (_required, options) => {
        if (options) seen.options = options;
        return { run: async () => {} };
      },
    });
    return { deps, seen };
  }

  it('refuses a JINI_DIAGNOSTIC_TOOL_IDS that is valid JSON but not an array', async () => {
    const { deps } = captureOptions({ [RUN_ID_ENV_VAR]: 'run-1', JINI_DIAGNOSTIC_TOOL_IDS: '{"a":1}' });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(deps.errWritten).toEqual(['jini-mcp: JINI_DIAGNOSTIC_TOOL_IDS must be a JSON array of registered tool IDs\n']);
  });

  it('refuses a JINI_DIAGNOSTIC_TOOL_IDS array holding a non-string entry', async () => {
    const { deps } = captureOptions({ [RUN_ID_ENV_VAR]: 'run-1', JINI_DIAGNOSTIC_TOOL_IDS: '["ok", 2]' });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(deps.errWritten).toEqual(['jini-mcp: JINI_DIAGNOSTIC_TOOL_IDS must be a JSON array of registered tool IDs\n']);
  });

  it('refuses malformed JINI_DIAGNOSTIC_TOOL_IDS JSON with the parser message', async () => {
    const { deps } = captureOptions({ [RUN_ID_ENV_VAR]: 'run-1', JINI_DIAGNOSTIC_TOOL_IDS: '[' });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(deps.errWritten).toHaveLength(1);
    expect(deps.errWritten[0]).toMatch(/^jini-mcp: .*JSON/);
  });

  it('omits diagnosticToolIds when the host supplies an empty array', async () => {
    const { deps, seen } = captureOptions({ [RUN_ID_ENV_VAR]: 'run-1', JINI_DIAGNOSTIC_TOOL_IDS: '[]' });
    await serve({}, deps);
    expect(seen.options).not.toHaveProperty('diagnosticToolIds');
  });

  async function resolveWith(url: string | undefined): Promise<{ resolved: string; errors: string[] }> {
    const errors: string[] = [];
    let resolved = '';
    const env: NodeJS.ProcessEnv = { [RUN_ID_ENV_VAR]: 'run' };
    if (url !== undefined) env[DAEMON_URL_ENV_VAR] = url;
    await serve({}, makeDeps({ env, writeErr: ({ text }) => { errors.push(text); },
      createMcpToolServer: required => ({ run: async () => { resolved = await required.resolveBaseUrl(); } }),
    }));
    return { resolved, errors };
  }

  it('returns an unparseable daemon URL verbatim without warning', async () => {
    expect(await resolveWith('not a url')).toEqual({ resolved: 'not a url', errors: [] });
  });

  it('does not warn for a remote HTTPS daemon URL', async () => {
    expect(await resolveWith('https://user:pw@daemon.example')).toEqual({ resolved: 'https://user:pw@daemon.example', errors: [] });
  });

  it('does not warn for a loopback plain-HTTP daemon URL', async () => {
    expect(await resolveWith('http://127.0.0.1:4111')).toEqual({ resolved: 'http://127.0.0.1:4111', errors: [] });
  });

  it('warns with the URL as given when a remote plain-HTTP URL carries no credentials', async () => {
    expect(await resolveWith('http://daemon.example:4111')).toEqual({ resolved: 'http://daemon.example:4111', errors: [
      'daemon URL http://daemon.example:4111 is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.',
    ] });
  });

  it('still serves with a bearer credential against a remote plain-HTTP daemon, warning only (reported, not fixed)', async () => {
    // The credential would travel in cleartext to a non-loopback host; the resolver only warns.
    const errors: string[] = [];
    let seen: McpToolServerOptions | undefined;
    await serve({}, makeDeps({
      env: { [RUN_ID_ENV_VAR]: 'run', [DAEMON_URL_ENV_VAR]: 'http://daemon.example', [DAEMON_TOKEN_ENV_VAR]: 'tok' },
      writeErr: ({ text }) => { errors.push(text); },
      createMcpToolServer: (required, options) => ({ run: async () => { seen = options; await required.resolveBaseUrl(); } }),
    }));
    expect(seen?.authHeaders).toEqual({ Authorization: 'Bearer tok' });
    expect(errors).toEqual(['daemon URL http://daemon.example is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.']);
  });

  it('redacts a password-only userinfo from the warning', async () => {
    const { errors } = await resolveWith('http://:pw@daemon.example');
    expect(errors).toEqual(['daemon URL http://daemon.example/ is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.']);
  });
});

/** Real stdio framing through serve's production assembly; no sockets or CLI subprocesses. */
async function bootPublishedBridge(options: { env?: NodeJS.ProcessEnv; fetchImpl: typeof fetch }) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const responses = new Map<number, { result: unknown; error?: unknown }>();
  const notifications: string[] = [];
  let buffer = '';
  let sequence = 0;
  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const frame = JSON.parse(buffer.slice(0, newline)) as { id?: number; method?: string; result: unknown; error?: unknown };
      buffer = buffer.slice(newline + 1);
      if (frame.id !== undefined) responses.set(frame.id, frame);
      if (frame.method) notifications.push(frame.method);
    }
  });
  let connected!: () => void;
  const ready = new Promise<void>(resolve => { connected = resolve; });
  const running = serve({}, makeDeps({
    env: { [RUN_ID_ENV_VAR]: 'published-run', [DAEMON_URL_ENV_VAR]: 'http://127.0.0.1:4111', ...options.env },
    stdin, stdout, fetchImpl: options.fetchImpl, generateToolUseId: () => 'published-use',
    createMcpToolServer: (required, serverOptions) => {
      const server = createMcpToolServer(required, serverOptions);
      return { run: async () => { const promise = server.run({}); connected(); await promise; } };
    },
  }));
  onTestFinished(async () => { stdin.end(); await running; stdout.destroy(); });
  await ready;
  const request = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++sequence;
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    await vi.waitFor(() => expect(responses.has(id)).toBe(true));
    const response = responses.get(id)!;
    expect(response.error).toBeUndefined();
    return response.result as T;
  };
  const init = await request<InitializeResult>('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm2-fixture', version: '1' },
  });
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { request, notifications, init, stdin };
}

const startupDescriptor = {
  id: 'content.read', description: 'Read content', readOnly: true,
  inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
};

describe('serve() — startup descriptors and live publication', () => {
  it('authenticates and deduplicates startup lookups before the first list, then invokes the concrete read tool', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === 'GET') return Response.json(startupDescriptor);
      return Response.json({ result: { executionId: 'read', status: 'completed', output: { title: 'hello' } } });
    };
    const bridge = await bootPublishedBridge({ fetchImpl, env: {
      [STARTUP_TOOL_IDS_ENV_VAR]: JSON.stringify(['content.read', 'content.read']),
      JINI_DIAGNOSTIC_TOOL_IDS: '["diagnostic_only"]', [DAEMON_TOKEN_ENV_VAR]: 'run-token',
    } });
    expect(bridge.init.capabilities.tools?.listChanged).toBe(true);
    const listed = await bridge.request<ListToolsResult>('tools/list');
    const concrete = listed.tools.find(tool => tool.annotations?.title === 'content.read')!;
    expect(concrete.inputSchema).toEqual(startupDescriptor.inputSchema);
    expect(concrete.annotations?.readOnlyHint).toBe(true);
    expect(listed.tools.some(tool => tool.name === 'diagnostic_only')).toBe(false);
    expect(calls.map(call => call.url)).toEqual(['http://127.0.0.1:4111/api/tools/content.read']);
    expect(bridge.notifications).not.toContain('notifications/tools/list_changed');
    const result = await bridge.request<CallToolResult>('tools/call', { name: concrete.name, arguments: { id: 'page' } });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ executionId: 'read', status: 'completed', output: { title: 'hello' } }) }]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ runId: 'published-run', toolUseId: 'published-use', toolId: 'content.read', input: { id: 'page' }, requireReadOnly: true });
    expect(calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer run-token')).toBe(true);
  });

  it('enables describe publication without startup IDs and never discovers from diagnostic IDs', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'GET'
      ? Response.json(startupDescriptor)
      : Response.json({ result: { executionId: 'dynamic', status: 'completed', output: 'ok' } }));
    const bridge = await bootPublishedBridge({ fetchImpl, env: { JINI_DIAGNOSTIC_TOOL_IDS: '["content.read"]' } });
    expect((await bridge.request<ListToolsResult>('tools/list')).tools.some(tool => tool.annotations?.title === 'content.read')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    const described = await bridge.request<CallToolResult>('tools/call', { name: 'describe_tool', arguments: { id: 'content.read' } });
    expect(described.isError).toBeUndefined();
    await vi.waitFor(() => expect(bridge.notifications).toContain('notifications/tools/list_changed'));
    const concrete = (await bridge.request<ListToolsResult>('tools/list')).tools.find(tool => tool.annotations?.title === 'content.read')!;
    expect((await bridge.request<CallToolResult>('tools/call', { name: concrete.name, arguments: { id: 'page' } })).isError).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['[', '{}', '["ok",2]', 'null'])('rejects malformed startup metadata %s before server construction', async raw => {
    const createServer = vi.fn(() => ({ run: async () => {} }));
    const deps = makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run', [STARTUP_TOOL_IDS_ENV_VAR]: raw }, createMcpToolServer: createServer });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(createServer).not.toHaveBeenCalled();
    expect(deps.errWritten).toHaveLength(1);
  });

  it.each([401, 403, 404])('fails startup on a %i descriptor response without exposing a partial list', async status => {
    const createServer = vi.fn(() => ({ run: async () => {} }));
    const deps = makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run', [STARTUP_TOOL_IDS_ENV_VAR]: '["first","second"]', [DAEMON_URL_ENV_VAR]: 'http://127.0.0.1' },
      createMcpToolServer: createServer, fetchImpl: async url => String(url).endsWith('/first')
        ? Response.json({ ...startupDescriptor, id: 'first' })
        : Response.json({ error: { code: 'DENIED', message: 'not admitted' } }, { status }),
    });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(createServer).not.toHaveBeenCalled();
    expect(deps.errWritten).toEqual([`jini-mcp: HTTP ${status}: DENIED: not admitted\n`]);
  });

  it('rejects a descriptor whose identity differs from the requested startup ID', async () => {
    const createServer = vi.fn(() => ({ run: async () => {} }));
    const deps = makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run', [STARTUP_TOOL_IDS_ENV_VAR]: '["requested"]', [DAEMON_URL_ENV_VAR]: 'http://127.0.0.1' },
      createMcpToolServer: createServer, fetchImpl: async () => Response.json(startupDescriptor),
    });
    await expect(serve({}, deps)).rejects.toMatchObject({ code: 1 });
    expect(createServer).not.toHaveBeenCalled();
    expect(deps.errWritten).toEqual(['jini-mcp: daemon returned a mismatched tool descriptor\n']);
  });

  it('isolates startup definitions and credentials across concurrent runs', async () => {
    const requests: { token: string | null; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (_url, init = {}) => {
      const token = new Headers(init.headers).get('Authorization');
      const id = token === 'Bearer first' ? 'first_tool' : 'second_tool';
      if (init.method === 'GET') return Response.json({ ...startupDescriptor, id });
      requests.push({ token, body: JSON.parse(String(init.body)) });
      return Response.json({ result: { executionId: id, status: 'completed', output: id } });
    };
    const bridges = await Promise.all(['first', 'second'].map(run => bootPublishedBridge({ fetchImpl,
      env: { [RUN_ID_ENV_VAR]: run, [DAEMON_TOKEN_ENV_VAR]: run, [STARTUP_TOOL_IDS_ENV_VAR]: JSON.stringify([`${run}_tool`]) },
    })));
    for (const [index, run] of ['first', 'second'].entries()) {
      const bridge = bridges[index]!;
      const names = (await bridge.request<ListToolsResult>('tools/list')).tools.map(tool => tool.name);
      expect(names.filter(name => name === 'first_tool' || name === 'second_tool')).toEqual([`${run}_tool`]);
      await bridge.request<CallToolResult>('tools/call', { name: `${run}_tool`, arguments: { id: run } });
    }
    expect(requests.map(request => ({ token: request.token, runId: (request.body as { runId: string }).runId })))
      .toEqual([{ token: 'Bearer first', runId: 'first' }, { token: 'Bearer second', runId: 'second' }]);
  });

  it.each([true, false])('preserves delegated approval outcomes through typed and legacy write ingress (allowed=%s)', async allowed => {
    const posts: Record<string, unknown>[] = [];
    const registry = createToolRegistry({});
    const handler = vi.fn(async () => 'done');
    const confirm = vi.fn(() => allowed ? 'confirm' as const : 'deny' as const);
    const descriptor = { ...startupDescriptor, readOnly: false, requiresConfirmation: true };
    registry.register({ descriptor, policy: { authorize: () => 'allow' }, handler });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const { run } = await lifecycle.start({ contextRef: 'm2-approval' });
    const toolExecutor = createToolExecutor({ registry }, { delegate: { onConfirm: confirm } });
    const fetchImpl: typeof fetch = async (_url, init = {}) => {
      if (init.method === 'GET') return Response.json(descriptor);
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const parsed = delegatedToolExecuteRoute.parse({ body: JSON.parse(String(init.body)), query: {}, params: {} });
      if (!parsed.ok) throw new Error('invalid delegated request');
      const result = await delegatedToolExecuteRoute.handle({ input: parsed.value, deps: {
        lifecycle, toolExecutor, toolRegistry: registry, resolvePrincipal: () => ({ id: 'host' }), onInternalError: () => {},
      } }, init.signal ? { signal: init.signal } : {});
      return result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: 403 });
    };
    const bridge = await bootPublishedBridge({ fetchImpl, env: { [RUN_ID_ENV_VAR]: run.id, [STARTUP_TOOL_IDS_ENV_VAR]: '["content.read"]' } });
    const concrete = (await bridge.request<ListToolsResult>('tools/list')).tools.find(tool => tool.annotations?.title === 'content.read')!;
    expect(concrete.annotations?.readOnlyHint).toBe(false);
    const typed = await bridge.request<CallToolResult>('tools/call', { name: concrete.name, arguments: { id: 'page' } });
    const legacy = await bridge.request<CallToolResult>('tools/call', { name: 'execute_delegated_tool', arguments: { toolId: 'content.read', input: { id: 'page' } } });
    expect(typed.isError).toBe(legacy.isError);
    expect(typed.isError).toBe(allowed ? undefined : true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(allowed ? 2 : 0);
    expect(posts).toEqual(Array.from({ length: 2 }, () => ({ runId: run.id, toolUseId: 'published-use', toolId: 'content.read', input: { id: 'page' } })));
  });

  it('forwards MCP cancellation for a typed startup operation to the delegated callback', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_url, init = {}) => {
      if (init.method === 'GET') return Response.json(startupDescriptor);
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    };
    const bridge = await bootPublishedBridge({ fetchImpl, env: { [STARTUP_TOOL_IDS_ENV_VAR]: '["content.read"]' } });
    const concrete = (await bridge.request<ListToolsResult>('tools/list')).tools.find(tool => tool.annotations?.title === 'content.read')!;
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: concrete.name, arguments: { id: 'page' } } })}\n`);
    await vi.waitFor(() => expect(signal).toBeDefined());
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99, reason: 'user cancelled' } })}\n`);
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});

it('finishes every startup lookup before constructing the server and pins one daemon URL', async () => {
  let releaseDescriptor!: (value: Response) => void;
  const descriptorPending = new Promise<Response>(resolve => { releaseDescriptor = resolve; });
  const resolveDaemonUrl = vi.fn(async () => 'http://127.0.0.1:4111');
  const fetchImpl = vi.fn<typeof fetch>(async () => descriptorPending);
  const createServer = vi.fn((required: McpToolServerRequiredArgs, options: McpToolServerOptions = {}) => ({ run: async () => {
    expect(await required.resolveBaseUrl()).toBe('http://127.0.0.1:4111');
    expect(options.delegatedTools?.initialTools).toEqual([startupDescriptor]);
  } }));
  const running = serve({}, makeDeps({ env: { [RUN_ID_ENV_VAR]: 'run', [STARTUP_TOOL_IDS_ENV_VAR]: '["content.read"]' },
    fetchImpl, resolveDaemonUrl, createMcpToolServer: createServer,
  }));
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  expect(createServer).not.toHaveBeenCalled();
  releaseDescriptor(Response.json(startupDescriptor));
  await running;
  expect(createServer).toHaveBeenCalledTimes(1);
  expect(resolveDaemonUrl).toHaveBeenCalledTimes(1);
});
