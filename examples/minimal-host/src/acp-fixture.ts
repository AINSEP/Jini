import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';

/**
 * A portable ACP subprocess fixture. It requires no vendor binary or account,
 * but exercises the real Node spawn + ACP handshake + permission path used by
 * registered ACP agents in the engine.
 */
const ACP_FIXTURE = String.raw`
let buffered = '';
let promptRequestId = null;
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
function handle(frame) {
  if (frame.method === 'initialize') {
    send({ jsonrpc: '2.0', id: frame.id, result: {} });
    return;
  }
  if (frame.method === 'session/new') {
    send({ jsonrpc: '2.0', id: frame.id, result: { sessionId: 'minimal-host-acp', models: { currentModelId: 'fixture-model', availableModels: [{ modelId: 'fixture-model', name: 'Fixture Model' }] } } });
    return;
  }
  if (frame.method === 'session/prompt') {
    promptRequestId = frame.id;
    send({
      jsonrpc: '2.0', id: 91, method: 'session/request_permission',
      params: {
        sessionId: 'minimal-host-acp',
        toolCall: { toolCallId: 'minimal-host-call', title: 'fixture operation' },
        options: [{ optionId: 'allow', kind: 'allow_once' }]
      }
    });
    return;
  }
  if (frame.id === 91 && frame.result && frame.result.outcome && frame.result.outcome.optionId === 'allow') {
    send({
      jsonrpc: '2.0', method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', text: 'minimal-host ACP completed run' } }
    });
    send({ jsonrpc: '2.0', id: promptRequestId, result: {} });
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

export function acpFixtureDef(): RuntimeAgentDef {
  return {
    id: 'acp-fixture',
    name: 'ACP Fixture',
    bin: process.execPath,
    versionArgs: ['--version'],
    // Static host definitions need a concrete fallback when the CLI has no discovery API.
    fallbackModels: [{ id: 'fixture-model', label: 'Fixture Model' }],
    buildArgs: () => ['-e', ACP_FIXTURE],
    streamFormat: 'acp-json-rpc',
  };
}

