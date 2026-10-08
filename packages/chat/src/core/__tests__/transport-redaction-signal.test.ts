import { expect, it } from 'vitest';
import { createAssistantTransportClient, type AssistantTransportPorts } from '../assistant-client/transport.js';
import { createAgUiRunClient } from '../assistant-client/ag-ui-transport.js';
import type { ChatMessage } from '../messages.js';
import { notices } from '../run-events/__tests__/fixture.js';

const handlers = { onEvent: () => {}, onDone: () => {}, onError: () => {} };
const history: ChatMessage[] = [{ id: 'u', role: 'user', content: 'Connect [token removed]', secretRedaction: { secretRedacted: true, count: 1 } }];

it('carries the signal in daemon, BYOK and AG-UI payloads without adding model prose to chat', async () => {
  const signal = new AbortController().signal;
  const byokBodies: Array<{ messages: unknown }> = [];
  const agUiBodies: Array<{ forwardedProps?: unknown }> = [];
  const agUi = createAgUiRunClient({ ports: {
    endpoint: '/ag-ui', runIdPrefix: 'ag:', customEventNames: { usage: 'usage', status: 'status', extensionPrefix: 'ext:' }, mintId: () => 'id',
    createAgent: () => ({ abortController: new AbortController(), abortRun: () => {},
      run: input => { agUiBodies.push(input); return { subscribe: observer => observer.next({ type: 'RUN_STARTED', threadId: 't', runId: 'ag:id' }) }; },
    }),
  } }, {});
  const ports: AssistantTransportPorts = {
    runsUrl: '/runs', byokTurnUrl: '/byok', byokRunIdPrefix: 'byok:', notices, mintId: () => 'id',
    projectPrompt: ({ prompt }) => prompt, projectInput: ({ input }) => input,
    bindRun: () => {}, runBinding: () => undefined, followRun: () => {}, agUi,
    acceptRun: async () => new Response(JSON.stringify({ run: { id: 'run' } })),
    fetch: async (_url, init) => { byokBodies.push(JSON.parse(String(init?.body))); return new Response('event: done\ndata: {}\n\n'); },
  };
  const client = createAssistantTransportClient({ ports }, {});
  expect(client.buildLocalCliContextRef({ input: { history, signal }, prompt: history[0]!.content }, {})).toEqual({ prompt: 'Connect [token removed]', assistantMessageId: undefined, secretRedacted: true });
  expect(client.buildLocalCliContextRef({ input: { history: [{ id: 'u', role: 'user', content: 'Explain [token removed]' }], signal }, prompt: 'Explain [token removed]' }, {})).toEqual({ prompt: 'Explain [token removed]', assistantMessageId: undefined });
  await client.createAssistantTransport({ options: { getExecutionConfig: () => ({ mode: 'byok', byok: { providerId: 'p', protocol: 'anthropic', baseUrl: '/provider', apiKey: '', model: 'm' }, localCli: { agentId: 'a' } }) } }, {}).startRun({ history, signal }, handlers);
  expect(byokBodies[0]?.messages).toEqual([{ role: 'user', content: 'Connect [token removed]', secretRedacted: true }]);
  await client.createAssistantTransport({ options: { getAgUiEnabled: () => true } }, {}).startRun({ history, agentId: 'a', signal }, handlers);
  expect(agUiBodies[0]?.forwardedProps).toEqual({ agentId: 'a', secretRedacted: true });
  expect(history[0]?.content).toBe('Connect [token removed]');
});
