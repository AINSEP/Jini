import { expect, it } from 'vitest';
import { createAssistantTransportClient, type AssistantTransportPorts } from '../assistant-client/transport.js';
import type { ChatMessage } from '../messages.js';
import { notices } from '../run-events/__tests__/fixture.js';

async function dispatch(history: ChatMessage[], agentId = 'claude') {
  let context: Record<string, string> = {};
  const ports: AssistantTransportPorts = {
    runsUrl: '/runs', byokTurnUrl: '/byok', byokRunIdPrefix: 'byok:', notices, mintId: () => 'id',
    fetch: globalThis.fetch, projectPrompt: ({ prompt }) => prompt, projectInput: ({ input }) => input,
    bindRun: () => {}, runBinding: () => undefined, followRun: () => {},
    agUi: {} as AssistantTransportPorts['agUi'],
    acceptRun: async ({ body }) => {
      context = JSON.parse((body as { contextRef: string }).contextRef);
      return new Response(JSON.stringify({ run: { id: 'run' } }));
    },
  };
  const client = createAssistantTransportClient({ ports });
  await client.createAssistantTransport({ options: { getResumeCapableAgentIds: () => new Set(['claude']) } })
    .startRun({ history, agentId, signal: new AbortController().signal }, { onEvent() {}, onDone() {}, onError() {} });
  return context;
}

const history: ChatMessage[] = [
  { id: 'u0', role: 'user', content: 'old request' },
  { id: 'b0', role: 'assistant', agentId: 'claude', content: 'old answer', runStatus: 'succeeded' },
  { id: 'u1', role: 'user', content: 'Add kinetic animations' },
  { id: 'a1', role: 'assistant', agentId: 'antigravity', content: 'I will inspect the page', runStatus: 'succeeded' },
  { id: 'u2', role: 'user', content: 'Please continue' },
  { id: 'a2', role: 'assistant', agentId: 'antigravity', content: '', runStatus: 'failed', events: [{ kind: 'status', label: 'permission denied in headless mode' }] },
  { id: 'u3', role: 'user', content: 'can you do it please?' },
];

it('seeds a resumed agent with other agents\' unseen replies, failures and user requests', async () => {
  const { prompt } = await dispatch(history);
  expect(prompt).toContain('Add kinetic animations');
  expect(prompt).toContain('I will inspect the page');
  expect(prompt).toContain('antigravity run failed');
  expect(prompt).toContain('permission denied in headless mode');
  expect(prompt).toContain('can you do it please?');
  expect(prompt).not.toContain('old answer');
  expect(history[5]?.content).toBe('');
});

it('gives a first-time and stateless agent the bounded conversation including failed turns', async () => {
  for (const agentId of ['claude', 'qwen']) {
    const { prompt } = await dispatch(history.slice(2), agentId);
    expect(prompt).toContain('Add kinetic animations');
    expect(prompt).toContain('antigravity run failed');
    expect(prompt).toContain('permission denied in headless mode');
  }
});

it('includes partial failed output and its status detail together in a handoff', async () => {
  const failed: ChatMessage = {
    id: 'failed', role: 'assistant', agentId: 'antigravity', runStatus: 'failed',
    content: 'I inspected the animation container.',
    events: [{ kind: 'status', label: 'Run failed', detail: 'The mcp permission was auto-denied in headless mode.' }],
  };
  const { prompt } = await dispatch([history[2]!, failed, history[6]!]);
  expect(prompt).toContain('not a completed answer');
  expect(prompt).toContain(failed.content);
  expect(prompt).toContain('Run failed');
  expect(prompt).toContain('The mcp permission was auto-denied in headless mode.');
  const progress = Array.from({ length: 80 }, () => ({ kind: 'status' as const, label: 'Checking the page. '.repeat(10) }));
  const { prompt: bounded } = await dispatch([{ ...failed, content: 'x'.repeat(20_000), events: [...progress, ...failed.events!] }, history[6]!]);
  expect(bounded).toContain('The mcp permission was auto-denied in headless mode.');
  expect(bounded?.length).toBeLessThan(12_000);
  expect(failed.content).toBe('I inspected the animation container.');
});

it('carries a bounded complete cold-start prompt even when a resumed agent only needs the newest request', async () => {
  const many: ChatMessage[] = Array.from({ length: 90 }, (_, index) => ({
    id: String(index), role: index % 2 ? 'assistant' : 'user', content: `turn-${index}-end`,
    ...(index % 2 ? { agentId: 'claude', runStatus: 'succeeded' as const } : {}),
  }));
  many.push({ id: 'latest', role: 'user', content: 'latest request' });
  const { prompt, coldStartContext } = await dispatch(many);
  expect(prompt).toBe('latest request');
  expect(coldStartContext).toContain('turn-89-end');
  expect(coldStartContext).not.toContain('turn-0-end');
  expect(coldStartContext!.split('latest request')).toHaveLength(2);
  expect((coldStartContext!.match(/^## (user|assistant)$/gm) ?? []).length).toBeLessThanOrEqual(40);
});
