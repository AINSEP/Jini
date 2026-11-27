import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useSurfaceRecovery } from '../useSurfaceRecovery.js';
import { SURFACE_EXCHANGE_META } from '../../../core/surface-recovery.js';
import type { UIResource } from '@jini-ai/protocol/mcp-ui';

const info = { exchangeId: 'old', toolId: 'save', runId: 'run' };
const resource: UIResource = { type: 'resource', resource: {
  uri: 'ui://card/old', mimeType: 'text/html', text: '<form>old</form>', _meta: { [SURFACE_EXCHANGE_META]: info },
} };

test('opening an unanswered card restores it and leaves one pending subscription through focus', async () => {
  let signal: AbortSignal | undefined;
  const restore = vi.fn(async (input: { signal: AbortSignal; onSurface: (emission: { channel: string; payload: Record<string, unknown> }) => void }) => {
    signal = input.signal;
    input.onSurface({ channel: 'mcp-ui', payload: { resource: { ...resource, resource: { ...resource.resource, text: '<form>new</form>' } }, surfaceExchange: { ...info, exchangeId: 'new' } } });
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const caller = Object.assign(async () => ({ delivered: true }), { restore, answer: vi.fn() });
  const { result, unmount } = renderHook(() => useSurfaceRecovery({ resource, call: { name: 'save', input: {} }, runStreaming: false, onToolCall: caller }));
  await vi.waitFor(() => expect(result.current.resource?.resource.text).toBe('<form>new</form>'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

test('a saved card never re-executes its tool when the owner opens the chat', () => {
  const restore = vi.fn();
  const caller = Object.assign(async () => ({ delivered: true }), { restore, answer: vi.fn() });
  const { unmount } = renderHook(() => useSurfaceRecovery({ resource,
    call: { name: 'save', input: {}, result: { content: 'Saved', isError: false } }, runStreaming: false, onToolCall: caller }));
  expect(restore).not.toHaveBeenCalled();
  unmount();
});

test('submits through the recovery answer port and aborts a pending answer when the card closes', async () => {
  type Caller = import('../../features/chat-pane/create-mcp-ui-tool-caller.js').RecoverableMcpUiToolCaller;
  const fallback = vi.fn(() => ({ saved: false }));
  const restore = vi.fn(async () => undefined);
  const answer = vi.fn<Caller['answer']>()
    .mockResolvedValueOnce({ saved: true, revision: 7 })
    .mockImplementationOnce(({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ saved: false, canceled: true }), { once: true });
    }));
  const caller: Caller = Object.assign(fallback, { restore, answer });
  const { result, unmount } = renderHook(() => useSurfaceRecovery({
    resource, call: { name: 'save', input: {} }, runStreaming: true, onToolCall: caller,
  }));

  const submit = result.current.onToolCall;
  if (!submit) throw new Error('recoverable card lost its submit callback');
  const first = { name: 'save', arguments: { choice: 'keep' } };
  expect(await submit(first)).toEqual({ saved: true, revision: 7 });
  const second = { name: 'save', arguments: { choice: 'discard' } };
  const pending = submit(second);
  expect(answer.mock.calls).toEqual([
    [{ call: first, signal: expect.any(AbortSignal), onSurface: expect.any(Function) }],
    [{ call: second, signal: expect.any(AbortSignal), onSurface: expect.any(Function) }],
  ]);
  const completedSignal = answer.mock.calls[0]![0].signal;
  const pendingSignal = answer.mock.calls[1]![0].signal;
  expect(pendingSignal.aborted).toBe(false);
  expect(fallback).not.toHaveBeenCalled();
  unmount();
  expect(completedSignal.aborted).toBe(false);
  expect(pendingSignal.aborted).toBe(true);
  expect(await pending).toEqual({ saved: false, canceled: true });
});

test('closing the card aborts its second answer after the first settles while the second is pending', async () => {
  type Caller = import('../../features/chat-pane/create-mcp-ui-tool-caller.js').RecoverableMcpUiToolCaller;
  let finishFirst!: (value: { saved: boolean }) => void;
  const firstResult = new Promise<{ saved: boolean }>((resolve) => { finishFirst = resolve; });
  // Leave answer two pending until after checking teardown, then settle it in the test regardless of its signal.
  let finishSecond!: (value: { saved: boolean }) => void;
  const secondResult = new Promise<{ saved: boolean }>((resolve) => { finishSecond = resolve; });
  const answer = vi.fn<Caller['answer']>().mockReturnValueOnce(firstResult).mockReturnValueOnce(secondResult);
  const caller: Caller = Object.assign(() => ({ saved: false }), { restore: async () => undefined, answer });
  const { result, unmount } = renderHook(() => useSurfaceRecovery({
    resource, call: { name: 'save', input: {} }, runStreaming: true, onToolCall: caller,
  }));
  const submit = result.current.onToolCall;
  if (!submit) throw new Error('recoverable card lost its submit callback');
  const first = submit({ name: 'save', arguments: { choice: 'first' } });
  const second = submit({ name: 'save', arguments: { choice: 'second' } });
  const firstSignal = answer.mock.calls[0]![0].signal;
  const secondSignal = answer.mock.calls[1]![0].signal;
  finishFirst({ saved: true });
  expect(await first).toEqual({ saved: true });
  expect(firstSignal.aborted).toBe(false);
  expect(secondSignal.aborted).toBe(false);
  unmount();
  finishSecond({ saved: false });
  expect(await second).toEqual({ saved: false });
  expect(secondSignal.aborted).toBe(true);
});
