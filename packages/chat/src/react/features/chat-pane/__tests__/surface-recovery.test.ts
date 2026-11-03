import { expect, test, vi } from 'vitest';
import { createMcpUiToolCaller } from '../create-mcp-ui-tool-caller.js';

const info = { exchangeId: 'expired', toolId: 'external_mcp_save', runId: 'run' };
const emission = { channel: 'mcp-ui', payload: { resource: { type: 'resource', resource: { uri: 'ui://new-card', text: '<form></form>' } }, surfaceExchange: { ...info, exchangeId: 'new' } } };

test('returning to an expired card requests its original invocation without resending tool arguments', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(`${JSON.stringify({ type: 'surface', emission })}\n${JSON.stringify({ type: 'restored', ok: true })}\n`, { headers: { 'content-type': 'application/x-ndjson' } }));
  const onSurface = vi.fn();
  const caller = createMcpUiToolCaller({ baseUrl: '', fetch });
  await caller.restore({ ...info, onSurface, signal: new AbortController().signal });
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ toolName: info.toolId, params: {}, exchangeId: info.exchangeId, restore: true });
  expect(onSurface).toHaveBeenCalledWith(emission);
});

test('a late credential answer is sent once and a reissued card is streamed before the save finishes', async () => {
  let send!: (value: string) => void;
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    send = value => controller.enqueue(new TextEncoder().encode(value));
    finish = () => controller.close();
  } });
  const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }));
  const onSurface = vi.fn();
  const caller = createMcpUiToolCaller({ baseUrl: '', fetch });
  const answer = caller.answer({ call: { name: info.toolId, arguments: { __exchangeId: info.exchangeId, token: 'human-only' } }, onSurface, signal: new AbortController().signal });
  send(`${JSON.stringify({ type: 'surface', emission })}\n`);
  await vi.waitFor(() => expect(onSurface).toHaveBeenCalledWith(emission));
  send(`${JSON.stringify({ type: 'restored', ok: true })}\n`);
  finish();
  expect(await answer).toEqual({ delivered: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});
