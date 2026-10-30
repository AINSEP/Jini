import { expect, it } from 'vitest';
import { createAssistantTransportClient, type AssistantTransportPorts } from '../transport.js';
import { createAgUiRunClient } from '../ag-ui-transport.js';
import { redactUserText } from '../../user-text-redaction.js';
import type { ChatMessage } from '../../messages.js';
import { notices } from '../../run-events/__tests__/fixture.js';

const handlers = { onEvent: () => {}, onDone: () => {}, onError: () => {} };
const oldPaste: ChatMessage = { id: 'old', role: 'user', content: 'Connect [token removed]', secretRedaction: { secretRedacted: true, count: 1 } };

function fixture() {
  const daemon: Array<Record<string, unknown>> = [];
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
    acceptRun: async ({ body }) => { daemon.push(JSON.parse((body as { contextRef: string }).contextRef)); return new Response(JSON.stringify({ run: { id: 'run' } })); },
    fetch: async () => new Response('event: done\ndata: {}\n\n'),
  };
  return { client: createAssistantTransportClient({ ports }, {}), daemon, agUiBodies };
}

it.each(['claude', 'codex', 'antigravity', 'another-cli'])('%s does not replay an earlier user paste signal', async agentId => {
  const { client, daemon } = fixture();
  const history: ChatMessage[] = [oldPaste, { id: 'answer', role: 'assistant', content: 'Use the saved connection.' },
    { id: 'current', role: 'user', content: 'deploy to vercel please' }, { id: 'stub', role: 'assistant', content: '' }];
  await client.createAssistantTransport({}, {}).startRun({ history, agentId, signal: new AbortController().signal }, handlers);
  expect(daemon[0]?.secretRedacted).toBeUndefined();
  expect(daemon[0]?.userPrompt).toBe('deploy to vercel please');
  expect(daemon[0]?.coldStartContext).toContain('Connect [token removed]');
});

it.each([false, true])('AG-UI sends only the current user paste signal (%s)', async currentPaste => {
  const { client, agUiBodies } = fixture();
  const current: ChatMessage = currentPaste ? { ...oldPaste, id: 'current' } : { id: 'current', role: 'user', content: 'deploy to vercel please' };
  await client.createAssistantTransport({ options: { getAgUiEnabled: () => true } }, {}).startRun({ history: [oldPaste, current], agentId: 'any-cli', signal: new AbortController().signal }, handlers);
  expect(agUiBodies[0]?.forwardedProps).toEqual({ agentId: 'any-cli', ...(currentPaste ? { secretRedacted: true } : {}) });
});

it('still carries a fresh current paste signal after an ordinary older turn', async () => {
  const { client, daemon } = fixture();
  await client.createAssistantTransport({}, {}).startRun({ history: [{ id: 'older', role: 'user', content: 'hello' }, oldPaste], signal: new AbortController().signal }, handlers);
  expect(daemon[0]?.secretRedacted).toBe(true);
});

it.each([
  'deploy to vercel please', 'https://zoran-new.vercel.app',
  'dpl_BgpnsHVc9pYuw1yreP2D31F6c3BA', '58e5ff98-7805-485d-b5d4-1da914b1cbc1',
  'The system reports a removed credential; if it was real, rotate it.', 'Explain [token removed]',
])('does not treat recorded public conversation text as a secret: %s', text => {
  expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
});
