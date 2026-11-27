import { afterEach, describe, expect, it } from 'vitest';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createDurableRunStore } from '../durable-run-store.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const scope = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const isDaemonRunId = ({ runId }: { runId: string }) => runId.startsWith('daemon-');
let f: RuntimeFixture;
afterEach(() => { f?.close(); });

async function acceptWith(context: Record<string, unknown>) {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope, isDaemonRunId }, { now: () => 1 });
  await history.create({ id: 'c' });
  const store = createDurableRunStore({ kernel: f.kernel, isDaemonRunId });
  const run = await store.accept({ conversationId: 'c', messageId: 'a1', runId: 'daemon-1', principalId: 'alice', workspaceId: 'ws',
    now: 100, request: { agentId: 'codex', contextRef: JSON.stringify(context) } }, {});
  const [row] = f.rows<{ accepted_json: string }>('SELECT accepted_json FROM assistant_run_attempts WHERE message_id = ?', 'a1');
  return { run, acceptedJson: row?.accepted_json ?? '' };
}

// The accepted request is stored for recovery and replay; the user's text in it is masked like the user's chat row.
describe('accepted run request storage', () => {
  it('masks a credential in the accepted user message and prompt before storing the request', async () => {
    const content = 'my password=Hx7short';
    const { run, acceptedJson } = await acceptWith({ conversationId: 'c', prompt: `user: ${content}`,
      userMessage: { id: 'u1', role: 'user', content, createdAt: 90 } });
    expect(acceptedJson).not.toContain('Hx7short');
    const context = JSON.parse(JSON.parse(acceptedJson).contextRef);
    expect(context.userMessage.content).toBe('my password=[token removed]');
    expect(context.prompt).toBe('user: my password=[token removed]');
    expect(context.conversationId).toBe('c');
    expect(JSON.stringify(run)).not.toContain('Hx7short');
  });

  it('stores a request with nothing to mask unchanged', async () => {
    const context = { conversationId: 'c', prompt: 'user: hi', userMessage: { id: 'u1', role: 'user', content: 'hi', createdAt: 90 } };
    const { acceptedJson } = await acceptWith(context);
    expect(JSON.parse(acceptedJson)).toEqual({ agentId: 'codex', contextRef: JSON.stringify(context) });
  });
});

it('masks a legacy prompt without inventing a user message or modifying its conversation id', async () => {
  const { run, acceptedJson } = await acceptWith({ conversationId: 'c', prompt: 'user: password=Hx7short' });
  expect(JSON.parse(JSON.parse(acceptedJson).contextRef)).toEqual({ conversationId: 'c', prompt: 'user: password=[token removed]' });
  expect(run?.transcript.map(({ id, role }) => ({ id, role }))).toEqual([{ id: 'a1', role: 'assistant' }]);
  expect(f.rows('SELECT role FROM ai_chat_messages WHERE conversation_id = ?', 'c')).toEqual([{ role: 'assistant' }]);
});
