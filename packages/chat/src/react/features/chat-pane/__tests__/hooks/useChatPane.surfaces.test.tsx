import { act, renderHook } from '@testing-library/react';
import type { SurfaceEmission } from '@jini-ai/core';
import { expect, it, vi } from 'vitest';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';

it('renders host-only request cards in the same transcript and disposes its listener', () => {
  let receive!: (emission: SurfaceEmission) => void;
  const dispose = vi.fn();
  const subscribeToSurfaces = (listener: typeof receive) => { receive = listener; return dispose; };
  const hook = renderHook(() => useChatPane({ transport: createFakeChatTransport(), agents: [], subscribeToSurfaces }));
  act(() => receive({ channel: 'mcp-ui', payload: { resource: { uri: 'ui://confirmation/1' } } }));
  expect(hook.result.current.conversation.messages).toMatchObject([{ role: 'assistant', content: '', events: [
    { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://confirmation/1' } },
  ] }]);
  hook.unmount(); expect(dispose).toHaveBeenCalledOnce();
});
