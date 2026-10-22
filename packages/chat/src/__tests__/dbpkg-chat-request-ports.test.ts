import { expect, it, vi } from 'vitest';
import { createMcpUiToolCaller } from '../react/features/chat-pane/create-mcp-ui-tool-caller.js';
import { createFrontendSessionBridge } from '../react/agent-bridge/frontend-session-bridge.js';

it('sends confirmed actions through the injected request port with the same wire envelope', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  const call = createMcpUiToolCaller({ baseUrl: 'https://daemon.example/', fetch }, { headers: { 'x-csrf': 'token' } });
  await expect(call({ name: 'confirm', arguments: { token: 'single-use' } })).resolves.toEqual({ ok: true });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('https://daemon.example/api/mcp-ui/tool-calls');
  expect(init?.credentials).toBe('same-origin');
  expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-csrf': 'token' });
  expect(JSON.parse(init?.body as string)).toEqual({ toolName: 'confirm', params: { token: 'single-use' } });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.signal?.aborted).toBe(false);
});

it('opens the host-selected stream without consulting a browser transport global', () => {
  const source = { addEventListener: vi.fn(), close: vi.fn() } as unknown as EventSource;
  const openStream = vi.fn(() => source);
  const request = vi.fn(async () => new Response(null, { status: 200 }));
  const bridge = createFrontendSessionBridge({ baseUrl: 'https://daemon.example', openStream, request });
  expect(openStream).toHaveBeenCalledTimes(1);
  expect(openStream.mock.calls[0]).toEqual([{
    url: expect.stringContaining('https://daemon.example/api/frontend-sessions/stream?capability=chat.'),
  }]);
  expect(request).not.toHaveBeenCalled();
  expect(bridge.bindToken()).toBeUndefined();
  bridge.close();
  expect(source.close).toHaveBeenCalledTimes(1);
});
