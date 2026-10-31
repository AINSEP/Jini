import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { ChatTransport } from '../../../core/transport.js';
import type { ChatPaneProps } from '../../../react/chat-pane.js';
import { EmbedChatWidget, mountEmbedChat } from '../embed.js';
import type { EmbedChatWidgetArgs } from '../embed.js';

const pane = vi.hoisted(() => ({ props: null as ChatPaneProps | null, mounts: 0 }));
vi.mock('../../../react/chat-pane.js', () => ({ ChatPane: (props: ChatPaneProps) => {
  pane.props = props;
  useEffect(() => { pane.mounts += 1; props.onMessagesChange?.(props.initialMessages ?? []); }, []);
  return <div data-testid="existing-pane">{props.header}</div>;
} }));
vi.mock('../../../react/components/JiniChatProvider.js', () => ({ JiniChatProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../../../react/components/ChatFab.js', () => ({ ChatFab: ({ label, onToggle, open }: { label: string; onToggle: () => void; open: boolean }) =>
  <button aria-expanded={open} onClick={onToggle}>{label}</button> }));
const target = { slug: 'article', title: 'Article', path: '/article' };
const nav = { type: 'navigate' as const, auto: true, target };
const highlight = { type: 'highlight' as const, target };
function reply(actions: unknown[], id = 'reply', runStatus: Exclude<ChatMessage['runStatus'], undefined> = 'succeeded'): ChatMessage {
  return { id, role: 'assistant', content: 'Answer', runStatus,
    events: actions.map(action => ({ kind: 'ext', name: 'page_directive', data: { kind: 'page_action', action } })) };
}
function fixture(initial: ChatMessage[] = []) {
  const order: string[] = [];
  const transport: ChatTransport = {
    startRun: async () => ({ runId: 'run' }), reattachRun: async (_runId, handlers) => handlers.onDone([]),
    fetchRunStatus: async () => null, stopRun: async () => {},
  };
  const widget: { -readonly [K in keyof EmbedChatWidgetArgs]: EmbedChatWidgetArgs[K] } = {
    agent: { id: 'host-agent', name: 'Host agent', available: true },
    copy: { title: 'Help', eyebrow: 'Visitor help', newThread: 'New thread', cancel: 'Keep chat', discard: 'Discard',
      fabLabel: 'Open help', placeholder: 'Your question',},
    transport,
    session: {
      load: vi.fn(() => ({ open: true, messages: initial })),
      save: vi.fn(() => { order.push('save'); }), clear: vi.fn(),
    },
    keyboard: { subscribe: () => () => {} },
    scheduleFrame: ({ callback }) => { callback(); return () => {}; },
  };
  return { widget, order };
}
function emit(messages: ChatMessage[]) { act(() => pane.props!.onMessagesChange!(messages)); }

describe('embed composition', () => {
  it('passes the host agent, copy, transport and restored transcript to the existing pane', () => {
    const initial: ChatMessage[] = [{ id: 'user', role: 'user', content: 'Hi' }];
    const { widget } = fixture(initial);
    render(<EmbedChatWidget {...widget} />);
    expect(pane.props!.agents).toEqual([widget.agent]);
    expect(pane.props!.initialSelection).toEqual({ agentId: 'host-agent' });
    expect(pane.props!.transport).toBe(widget.transport);
    expect(pane.props!.initialMessages).toEqual(initial);
    expect(pane.props!.placeholder).toBe('Your question');
    expect(pane.props!.variant).toBe('embed');
    expect(screen.getByRole('dialog', { name: 'Help' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Help' }).tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }));
    expect(widget.session.save).toHaveBeenLastCalledWith({ state: { open: false, messages: initial } });
  });
  it('confirms reset, remounts an empty pane and discards pending proposals', () => {
    const { widget } = fixture();
    render(<EmbedChatWidget {...widget} />);
    emit([reply([{ ...nav, auto: false }])]);
    const before = pane.mounts;
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(widget.session.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(widget.session.clear).toHaveBeenCalledTimes(1);
    expect(pane.mounts).toBe(before + 1);
    expect(pane.props!.initialMessages).toEqual([]);
    expect(screen.queryByText('Visit Article?')).toBeNull();
  });
  it('isolates transcripts and processed reply IDs between two widget instances', () => {
    const first = fixture();
    const second = fixture();
    const a = render(<EmbedChatWidget {...first.widget} />);
    const firstChange = pane.props!.onMessagesChange!;
    const b = render(<EmbedChatWidget {...second.widget} />);
    const secondChange = pane.props!.onMessagesChange!;
    act(() => firstChange([reply([nav])]));
    act(() => secondChange([reply([nav])]));
    a.unmount(); b.unmount();
  });
  it('mounts into the supplied node and returns cleanup', async () => {
    const { widget } = fixture();
    const element = document.createElement('div');
    document.body.append(element);
    let mounted!: ReturnType<typeof mountEmbedChat>;
    await act(async () => { mounted = mountEmbedChat({ element, widget }); });
    expect(element.querySelector('h2')!.textContent).toBe('Help');
    await act(async () => mounted.unmount({}));
    expect(element.childNodes.length).toBe(0);
    element.remove();
  });
});
