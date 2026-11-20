import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeChatSurfaces } from '../../../react/__tests__/fake-chat-surfaces.js';
import { ChatSurfacesProvider, type ChatSurfaces } from '../../../react/surfaces.js';
import { EmbedChatWidget, mountEmbedChat } from '../embed.js';
import type { EmbedChatWidgetArgs } from '../embed.js';

const widget: EmbedChatWidgetArgs = {
  agent: { id: 'host-agent', name: 'Host agent', available: true },
  copy: { title: 'Help', eyebrow: 'Visitor help', newThread: 'New thread', cancel: 'Keep chat', discard: 'Discard',
    fabLabel: 'Open help', placeholder: 'Your question' },
  transport: {
    startRun: async () => ({ runId: 'run' }), reattachRun: async (_runId, handlers) => handlers.onDone([]),
    fetchRunStatus: async () => null, stopRun: async () => {},
  },
  session: { load: () => ({ open: true, messages: [] }), save: () => {}, clear: () => {} },
  keyboard: { subscribe: () => () => {} },
  scheduleFrame: ({ callback }) => { callback(); return () => {}; },
};

describe('embed chat surfaces with the real pane', () => {
  it('mounts the composer and dialog into the supplied node and empties it on unmount', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const surfaces: ChatSurfaces = fakeChatSurfaces();
    let mounted!: ReturnType<typeof mountEmbedChat>;
    await act(async () => { mounted = mountEmbedChat({ element, widget, surfaces }); });
    expect(within(element).getByRole('textbox')).toHaveAttribute('placeholder', 'Your question');
    expect(within(element).getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    await act(async () => mounted.unmount({}));
    expect(element.childNodes.length).toBe(0);
    element.remove();
  });

  it('renders the composer directly under the host surfaces provider without another widget prop', () => {
    render(<ChatSurfacesProvider surfaces={fakeChatSurfaces()}><EmbedChatWidget {...widget} /></ChatSurfacesProvider>);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Your question');
  });
});
