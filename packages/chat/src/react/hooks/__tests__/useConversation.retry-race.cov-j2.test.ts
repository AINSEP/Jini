import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useConversation } from '../useConversation.js';
import { createFakeChatTransport } from '../testing/fake-transport.js';

/**
 * `retry` locates the failed reply in the last RENDER's transcript, but applies its reset
 * functionally. When a state update queued in the same tick has already removed that reply, the
 * reset must still land — rebuilt from the history `retry` resolved — rather than silently vanish
 * while a run for it is started anyway.
 */
it('re-appends the reset reply after the history when a same-tick update already removed it', async () => {
  const transport = createFakeChatTransport();
  const { result } = renderHook(() => useConversation({ transport }));
  await act(async () => {
    await result.current.sendMessage('first attempt');
  });
  act(() => transport.fail(new Error('network blip')));
  const [user, failed] = result.current.messages;

  await act(async () => {
    result.current.setMessages((prev) => prev.filter((m) => m.id !== failed!.id));
    await result.current.retry(failed!.id);
  });

  expect(result.current.messages.map((m) => m.id)).toEqual([user!.id, failed!.id]);
  expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: '' });
  expect(transport.calls).toHaveLength(2);
  expect(transport.calls[1]?.input.history.map((m) => m.content)).toEqual(['first attempt']);
});
