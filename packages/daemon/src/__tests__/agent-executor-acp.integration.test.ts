import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createAgentExecutor } from '../agent-executor.js';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@injini/agent-runtime';
import type { RunAgentPayload, RunProtocolEvent } from '@injini/protocol';

/**
 * A real Node subprocess speaking the smallest useful ACP conversation. It
 * sends a permission request after the prompt; only the host-selected `allow`
 * option makes it emit text and complete. Keeping it in-process as a script
 * makes this a portable integration fixture rather than a dependency on any
 * vendor CLI or credentials.
 */
const ACP_FIXTURE = String.raw`
let buffered = '';
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
function handle(frame) {
  if (frame.method === 'initialize') {
    send({ jsonrpc: '2.0', id: frame.id, result: {} });
    return;
  }
  if (frame.method === 'session/new') {
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

function fixtureDef(): RuntimeAgentDef {
  return {
    id: 'acp-fixture',
    name: 'ACP Fixture',
    bin: process.execPath,
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => ['-e', ACP_FIXTURE],
    streamFormat: 'acp-json-rpc',
  };
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
      resolveAgentLaunch: () =>
        ({
          selectedPath: process.execPath,
          pathResolvedPath: process.execPath,
          configuredOverridePath: null,
          launchPath: process.execPath,
          launchKind: 'selected',
          childPathPrepend: [],
          diagnostic: null,
        }) as AgentLaunchResolution,
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
    expect(text).toBe('ACP fixture completed.');
    expect(events.at(-1)).toMatchObject({ kind: 'end', payload: { status: 'succeeded' } });
  });
});
