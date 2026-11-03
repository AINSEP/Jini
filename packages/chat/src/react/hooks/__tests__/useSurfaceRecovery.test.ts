import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useSurfaceRecovery } from '../useSurfaceRecovery.js';
import { SURFACE_EXCHANGE_META } from '../../../core/surface-recovery.js';
import type { UIResource } from '@jini-ai/ui/mcp-ui';

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
