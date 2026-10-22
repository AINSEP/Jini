import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MCP_UI_EXPIRES_AT_META_KEY, MCP_UI_MIME_TYPE, type McpUiHostProps, type McpUiToolCallHandler } from '@jini-ai/ui/mcp-ui';
import { fakeClock } from '../../hooks/__tests__/fake-surface-expiry-clock.js';
import { McpUiSurfaceCard } from '../McpUiSurfaceCard.js';

const fake = vi.hoisted(() => ({ host: vi.fn<(props: McpUiHostProps) => null>(() => null) }));
vi.mock('@jini-ai/ui/mcp-ui', async (original) => ({
  ...await original<typeof import('@jini-ai/ui/mcp-ui')>(),
  McpUiHost: fake.host,
}));
const deadline = 1_700_000_300_000;
const event = { type: 'resource', resource: { uri: 'ui://review/1', mimeType: MCP_UI_MIME_TYPE, text: '<p>Choose</p>', _meta: { [MCP_UI_EXPIRES_AT_META_KEY]: deadline } } };
const base = { name: 'mcp-ui', runStreaming: true, runSucceeded: false, runId: 'run', sandboxProxyUrl: new URL('https://sandbox.example.test/proxy.html') };
beforeEach(() => fake.host.mockClear());

it.each([
  { events: [], answered: false, countdown: false },
  { events: [event], answered: false, countdown: true },
  { events: [event], answered: true, countdown: false },
  { events: [event, { ...event, resource: { ...event.resource, uri: 'ui://review/2' } }], answered: false, countdown: false },
])('starts a deadline only for a single unanswered surface: %j', ({ events, answered, countdown }) => {
  const clock = fakeClock(deadline - 2_000);
  render(<McpUiSurfaceCard {...base} events={events} answered={answered} expiryClock={clock.clock} />);
  expect(clock.liveTickers()).toBe(countdown ? 1 : 0);
  expect(screen.queryByRole('timer')?.textContent ?? null).toBe(countdown ? 'Expires in 0:02' : null);
});

it.each([
  { executor: false, observer: false },
  { executor: false, observer: true },
  { executor: true, observer: false },
  { executor: true, observer: true },
])('wraps the executor only when both delivery ports exist: %j', async ({ executor, observer }) => {
  const receipt = { delivered: true };
  const onToolCall = vi.fn<McpUiToolCallHandler>().mockResolvedValue(receipt);
  const onAnswered = vi.fn<() => void>();
  render(<McpUiSurfaceCard {...base} events={[event]} answered {...(executor ? { onToolCall } : {})} {...(observer ? { onAnswered } : {})} />);
  const forwarded = fake.host.mock.calls[0]![0].onToolCall;
  if (!executor) {
    expect(forwarded).toBeUndefined();
    expect(onAnswered).not.toHaveBeenCalled();
    return;
  }
  expect(forwarded === onToolCall).toBe(!observer);
  const call: Parameters<McpUiToolCallHandler>[0] = { name: 'answer', arguments: { choice: 'yes' } };
  expect(await forwarded!(call)).toBe(receipt);
  expect(onToolCall).toHaveBeenCalledWith(call);
  expect(onAnswered).toHaveBeenCalledTimes(observer ? 1 : 0);
});

it('reports only delivered results and propagates an executor rejection unchanged', async () => {
  const failure = new Error('delivery failed');
  const receipt = { delivered: false };
  const onToolCall = vi.fn<McpUiToolCallHandler>().mockResolvedValueOnce(receipt).mockRejectedValueOnce(failure);
  const onAnswered = vi.fn<() => void>();
  render(<McpUiSurfaceCard {...base} events={[event]} answered onToolCall={onToolCall} onAnswered={onAnswered} />);
  const forwarded = fake.host.mock.calls[0]![0].onToolCall!;
  const call: Parameters<McpUiToolCallHandler>[0] = { name: 'answer', arguments: {} };
  expect(await forwarded(call)).toBe(receipt);
  await expect(forwarded(call)).rejects.toBe(failure);
  expect(onAnswered).not.toHaveBeenCalled();
});
