import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle, type RunLifecycle } from '../run-lifecycle.js';
import { createAgentExecutor } from '../agent-executor.js';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunAgentPayload, RunProtocolEvent } from '@jini-ai/protocol';

/**
 * A real Node subprocess speaking the smallest useful ACP conversation. It
 * sends a permission request after the prompt; only the host-selected `allow`
 * option makes it emit text and complete. Keeping it in-process as a script
 * makes this a portable integration fixture rather than a dependency on any
 * vendor CLI or credentials.
 */
const ACP_FIXTURE = String.raw`
let buffered = '';
let receivedMcpServers = null;
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
function handle(frame) {
  if (frame.method === 'initialize') {
    send({ jsonrpc: '2.0', id: frame.id, result: {} });
    return;
  }
  if (frame.method === 'session/new') {
    receivedMcpServers = frame.params && frame.params.mcpServers;
    send({ jsonrpc: '2.0', id: frame.id, result: { sessionId: 'fixture-session' } });
    return;
  }
  if (frame.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      id: 91,
      method: 'session/request_permission',
      params: {
        sessionId: 'fixture-session',
        toolCall: { toolCallId: 'fixture-call', title: 'write fixture output' },
        options: [
          { optionId: 'reject', kind: 'reject_once' },
          { optionId: 'allow', kind: 'allow_once' }
        ]
      }
    });
    return;
  }
  if (frame.id === 91 && frame.result && frame.result.outcome && frame.result.outcome.optionId === 'allow') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', text: 'ACP fixture completed.' } }
    });
    // Echo back what session/new actually delivered, so a test can assert MCP-server delivery from
    // the real subprocess's own point of view rather than from a stubbed transport. Emitted only
    // when servers were delivered, so a run with no MCP injection stays byte-identical.
    if (Array.isArray(receivedMcpServers) && receivedMcpServers.length > 0) {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', text: ' MCP:' + JSON.stringify(receivedMcpServers) } }
      });
    }
    send({ jsonrpc: '2.0', id: 3, result: {} });
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  for (;;) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function fixtureDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'acp-fixture',
    name: 'ACP Fixture',
    bin: process.execPath,
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => ['-e', ACP_FIXTURE],
    streamFormat: 'acp-json-rpc',
    ...overrides,
  };
}

/** Shared launch resolution for the fixture — every field is the host Node binary, no PATH lookup. */
function fixtureLaunch(): AgentLaunchResolution {
  return {
    selectedPath: process.execPath,
    pathResolvedPath: process.execPath,
    configuredOverridePath: null,
    launchPath: process.execPath,
    launchKind: 'selected',
    childPathPrepend: [],
    diagnostic: null,
  } as AgentLaunchResolution;
}

/** Concatenated `text_delta` deltas for a finished run — what the fixture actually said. */
async function streamedText(lifecycle: RunLifecycle, runId: string): Promise<string> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream(runId, (event) => events.push(event));
  return events
    .filter((event) => event.kind === 'agent')
    .map((event) => event.payload as RunAgentPayload)
    .filter((payload): payload is Extract<RunAgentPayload, { type: 'text_delta' }> => payload.type === 'text_delta')
    .map((payload) => payload.delta)
    .join('');
}

/** Parses the fixture's ` MCP:[...]` echo of the `mcpServers` its `session/new` actually received. */
function echoedMcpServers(text: string): unknown[] {
  const marker = text.indexOf(' MCP:');
  if (marker < 0) return [];
  return JSON.parse(text.slice(marker + ' MCP:'.length)) as unknown[];
}

describe('AgentExecutor — ACP subprocess integration', () => {
  it('drives a real ACP child through audited permission, prompt streaming, and a successful lifecycle', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const onPermissionRequest = vi.fn(async (request) => {
      expect(request).toMatchObject({
        sessionId: 'fixture-session',
        toolCall: { toolCallId: 'fixture-call', title: 'write fixture output' },
        options: [
          { optionId: 'reject', kind: 'reject_once' },
          { optionId: 'allow', kind: 'allow_once' },
        ],
      });
      return { outcome: 'selected' as const, optionId: 'allow' };
    });
    const executor = createAgentExecutor({
      lifecycle,
      getAgentDef: (agentId) => (agentId === 'acp-fixture' ? fixtureDef() : null),
      resolveAgentLaunch: fixtureLaunch,
      applyAgentLaunchEnv: (env) => env,
      acpPermissionHandler: onPermissionRequest,
    });
    const { run } = await lifecycle.start({ contextRef: 'acp-fixture' });

    await executor.run({ runId: run.id, agentId: 'acp-fixture', prompt: 'say hello', cwd: process.cwd() });
    const terminal = await lifecycle.waitForTerminal(run.id);
    expect(terminal.state).toBe('succeeded');
    expect(onPermissionRequest).toHaveBeenCalledTimes(1);

    const events: RunProtocolEvent[] = [];
    await lifecycle.stream(run.id, (event) => events.push(event));
    const text = events
      .filter((event) => event.kind === 'agent')
      .map((event) => event.payload as RunAgentPayload)
      .filter((payload): payload is Extract<RunAgentPayload, { type: 'text_delta' }> => payload.type === 'text_delta')
      .map((payload) => payload.delta)
      .join('');
    // No MCP injection configured: the fixture's echo branch must not fire at all.
    expect(text).toBe('ACP fixture completed.');
    expect(events.at(-1)).toMatchObject({ kind: 'end', payload: { status: 'succeeded' } });
  });
});

/**
 * The `'acp-merge'` mechanism verified against a real spawned subprocess and the real
 * `attachAcpSession` transport — the closest analogue available here to the live smoke check that
 * confirmed the claude fix, without needing any vendor CLI or credentials. The fixture reports the
 * `mcpServers` its own `session/new` received, so these assert delivery from the *agent's* point of
 * view rather than from a stubbed attach call.
 */
describe("AgentExecutor — ACP subprocess integration: 'acp-merge' MCP bridge delivery", () => {
  function createExecutorFor(def: RuntimeAgentDef, lifecycle: RunLifecycle) {
    return createAgentExecutor({
      lifecycle,
      getAgentDef: (agentId) => (agentId === 'acp-fixture' ? def : null),
      resolveAgentLaunch: fixtureLaunch,
      applyAgentLaunchEnv: (env) => env,
      acpPermissionHandler: async () => ({ outcome: 'selected' as const, optionId: 'allow' }),
      mcpJsonInjection: {
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        daemonUrl: 'http://127.0.0.1:4242',
        credential: (runId) => `token-for-${runId}`,
      },
    });
  }

  it('delivers the jini bridge server to a real ACP child, in the default array env format', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const def = fixtureDef({ externalMcpInjection: 'acp-merge' });
    const executor = createExecutorFor(def, lifecycle);
    const { run } = await lifecycle.start({ contextRef: 'acp-fixture-mcp' });

    await executor.run({ runId: run.id, agentId: 'acp-fixture', prompt: 'say hello', cwd: process.cwd() });
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');

    expect(echoedMcpServers(await streamedText(lifecycle, run.id))).toEqual([
      {
        type: 'stdio',
        name: 'jini',
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: [
          { name: 'JINI_RUN_ID', value: run.id },
          { name: 'JINI_DAEMON_URL', value: 'http://127.0.0.1:4242' },
          { name: 'JINI_DAEMON_TOKEN', value: `token-for-${run.id}` },
        ],
      },
    ]);
  });

  // The one real per-vendor fork on this path (reasonix declares `acpMcpEnvFormat: 'map'`). The
  // executor emits env as a plain object precisely so `buildAcpSessionNewParams` can do this.
  it("honors a def's acpMcpEnvFormat: 'map' when shaping the delivered server env", async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const def = fixtureDef({ externalMcpInjection: 'acp-merge', acpMcpEnvFormat: 'map' });
    const executor = createExecutorFor(def, lifecycle);
    const { run } = await lifecycle.start({ contextRef: 'acp-fixture-mcp-map' });

    await executor.run({ runId: run.id, agentId: 'acp-fixture', prompt: 'say hello', cwd: process.cwd() });
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');

    expect(echoedMcpServers(await streamedText(lifecycle, run.id))).toEqual([
      {
        type: 'stdio',
        name: 'jini',
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: {
          JINI_RUN_ID: run.id,
          JINI_DAEMON_URL: 'http://127.0.0.1:4242',
          JINI_DAEMON_TOKEN: `token-for-${run.id}`,
        },
      },
    ]);
  });

  // SEC: the bridge credential reaches the ACP agent over the JSON-RPC session, and from there into
  // the MCP child's environment. It must never appear in the ACP child's own process arguments.
  it('never puts the bridge credential in the spawned ACP child\'s process arguments', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const def = fixtureDef({ externalMcpInjection: 'acp-merge' });
    const spawnArgs: string[][] = [];
    const executor = createAgentExecutor({
      lifecycle,
      getAgentDef: (agentId) => (agentId === 'acp-fixture' ? def : null),
      resolveAgentLaunch: fixtureLaunch,
      applyAgentLaunchEnv: (env) => env,
      acpPermissionHandler: async () => ({ outcome: 'selected' as const, optionId: 'allow' }),
      createCommandInvocation: (input) => {
        const args = [...(input.args ?? [])];
        spawnArgs.push(args);
        return { command: input.command, args, windowsVerbatimArguments: false };
      },
      mcpJsonInjection: {
        command: '/usr/bin/jini-mcp',
        daemonUrl: 'http://127.0.0.1:4242',
        credential: () => 'run-scoped-secret',
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'acp-fixture-mcp-sec' });

    await executor.run({ runId: run.id, agentId: 'acp-fixture', prompt: 'say hello', cwd: process.cwd() });
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');

    expect(spawnArgs).toHaveLength(1);
    expect(JSON.stringify(spawnArgs[0])).not.toContain('run-scoped-secret');
    // …while still actually reaching the agent over the session.
    expect(JSON.stringify(echoedMcpServers(await streamedText(lifecycle, run.id)))).toContain('run-scoped-secret');
  });
});
