import { describe, expect, it, vi } from 'vitest';
import { createFrontendRequestCaller } from '../create-frontend-request-caller.js';
const emission = { channel: 'mcp-ui', payload: { resource: { uri: 'ui://confirm/1' } } };
const result = { type: 'result', result: { status: 'completed', output: { clicked: true } } };
const response = (frames: unknown[]) => new Response(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });

it('sends only the frozen request and renders a streamed card before the final result', async () => {
  let sink!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) { sink = controller; } })));
  const onSurface = vi.fn();
  const call = createFrontendRequestCaller({ path: '/page-request', fetch, bindToken: () => 'token', onSurface }, { headers: () => ({ 'x-tab-id': 'tab' }) });
  const input = { handle: 'delete' };
  const pending = call({ capabilityId: 'page.click', input, signal: new AbortController().signal });
  input.handle = 'other';
  sink.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'surface', emission }) + '\n'));
  await vi.waitFor(() => expect(onSurface).toHaveBeenCalledWith(emission));
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ capabilityId: 'page.click', input: { handle: 'delete' }, bindToken: 'token' });
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-tab-id': 'tab' } });
  sink.enqueue(new TextEncoder().encode(JSON.stringify(result) + '\n')); sink.close();
  await expect(pending).resolves.toEqual({ clicked: true });
  expect(fetch).toHaveBeenCalledOnce();
});
it.each([
  { frames: [{ type: 'throw', error: { message: 'Wrong tab' } }], error: 'Wrong tab' },
  { frames: [{ type: 'result', result: { status: 'failed', error: 'Page action failed' } }], error: 'Page action failed' },
  { frames: [{ type: 'surface', emission }], error: 'outcome is unknown' },
])('fails closed without retries on $error', async ({ frames, error }) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response(frames));
  const call = createFrontendRequestCaller({ path: '/page-request', fetch, bindToken: () => 'token', onSurface: vi.fn() });
  await expect(call({ capabilityId: 'page.click', input: {}, signal: new AbortController().signal })).rejects.toThrow(error);
  expect(fetch).toHaveBeenCalledOnce();
});
it('refuses a missing current token without dispatching', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const call = createFrontendRequestCaller({ path: '/page-request', fetch, bindToken: () => undefined, onSurface: vi.fn() });
  await expect(call({ capabilityId: 'page.click', input: {}, signal: new AbortController().signal })).rejects.toThrow('attached');
  expect(fetch).not.toHaveBeenCalled();
});
it('reports authentication refusals and preserves the caller cancellation signal', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: 'Sign in to request this page action.' }), { status: 403 }));
  const signal = new AbortController().signal;
  const call = createFrontendRequestCaller({ path: '/page-request', fetch, bindToken: () => 'token', onSurface: vi.fn() });
  await expect(call({ capabilityId: 'page.click', input: {}, signal })).rejects.toThrow('Sign in');
  expect(fetch.mock.calls[0]![1]!.signal).toBe(signal);
});
