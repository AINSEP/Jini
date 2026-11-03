import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { __resetComposerDraftCacheForTests } from '../../../../hooks/composer-draft-cache.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';

const agents = [{ id: 'codex', name: 'Codex', available: true }];
const release = () => window.dispatchEvent(new Event('jini:release-check', { cancelable: true }));

describe('chat pane release safety', () => {
  beforeEach(() => __resetComposerDraftCacheForTests());

  it('streaming and queued input block release until settled work removes the blocker', async () => {
    const transport = createFakeChatTransport();
    const { result } = renderHook(() => useChatPane({ transport, agents, conversationId: 'pane', initialDraft: 'start' }));
    await act(() => result.current.send());
    expect(result.current.conversation.isStreaming).toBe(true);
    expect(release()).toBe(false);
    act(() => result.current.composer.setDraft('next turn'));
    await act(() => result.current.send());
    expect(result.current.queuedPrompt).toBe('next turn');
    expect(release()).toBe(false);
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.conversation.isStreaming).toBe(false));
    expect(release()).toBe(true);
  });

  it('an upload blocks release before a file has arrived and rejection removes the blocker', async () => {
    let rejectUpload!: (error: Error) => void;
    const transport = createFakeChatTransport();
    const uploadAttachments = () => new Promise<never>((_resolve, reject) => { rejectUpload = reject; });
    const { result } = renderHook(() => useChatPane({ transport, agents, uploadAttachments }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.addAttachments([new File(['x'], 'x.txt')]); });
    expect(release()).toBe(false);
    await act(async () => { rejectUpload(new Error('upload refused')); await pending; });
    expect(release()).toBe(true);
  });

  it('an unresolved send blocks release even before the streaming state renders', async () => {
    const fake = createFakeChatTransport();
    let accept!: () => void;
    const transport = { ...fake, startRun: async (...args: Parameters<typeof fake.startRun>) => {
      await new Promise<void>(resolve => { accept = resolve; });
      return fake.startRun(...args);
    } };
    const { result } = renderHook(() => useChatPane({ transport, agents, conversationId: 'sending', initialDraft: 'send me' }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.send(); });
    expect(release()).toBe(false);
    await act(async () => { accept(); await pending; });
    act(() => result.current.reset());
    expect(release()).toBe(true);
  });
});
