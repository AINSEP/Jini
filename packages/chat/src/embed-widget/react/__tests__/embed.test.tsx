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
      fabLabel: 'Open help', placeholder: 'Your question', proposalLabel: ({ title }) => `Visit ${title}?`, proposalGo: 'Visit' },
    transport, directiveEventName: 'page_directive',
    session: {
      load: vi.fn(() => ({ open: true, messages: initial })),
      save: vi.fn(() => { order.push('save'); }), clear: vi.fn(),
      enqueue: vi.fn(() => { order.push('enqueue'); }), drain: vi.fn(() => null),
    },
    pageActions: {
      allows: vi.fn(({ action }) => action.target.path.startsWith('/') && !action.target.path.startsWith('//')),
      navigate: vi.fn(() => { order.push('navigate'); return true; }), execute: vi.fn(() => true), clearHighlight: vi.fn(),
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
    expect(screen.getByRole('heading', { name: 'Help' }).tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }));
    expect(widget.session.save).toHaveBeenLastCalledWith({ state: { open: false, messages: initial } });
  });
  it('never replays a restored navigation directive', () => {
    const { widget } = fixture([reply([nav])]);
    render(<EmbedChatWidget {...widget} />);
    expect(widget.pageActions.navigate).not.toHaveBeenCalled();
    expect(widget.session.enqueue).not.toHaveBeenCalled();
  });
  it('waits for terminal status and writes queued treatment and transcript before navigation exactly once', () => {
    const { widget, order } = fixture();
    render(<EmbedChatWidget {...widget} />);
    emit([reply([nav, highlight], 'new', 'running')]);
    expect(widget.pageActions.navigate).not.toHaveBeenCalled();
    order.length = 0;
    const settled = [reply([nav, highlight], 'new')];
    emit(settled);
    expect(order.slice(0, 3)).toEqual(['enqueue', 'save', 'navigate']);
    expect(widget.session.enqueue).toHaveBeenCalledWith({ action: highlight });
    expect(widget.session.save).toHaveBeenCalledWith({ state: { open: true, messages: settled } });
    emit(settled);
    expect(widget.pageActions.navigate).toHaveBeenCalledTimes(1);
  });
  it('shows a non-auto proposal and only queues/navigates on its click', () => {
    const { widget, order } = fixture();
    render(<EmbedChatWidget {...widget} />);
    emit([reply([{ ...nav, auto: false }, highlight])]);
    expect(screen.getByText('Visit Article?')).toBeInTheDocument();
    expect(widget.pageActions.navigate).not.toHaveBeenCalled();
    order.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Visit' }));
    expect(order.slice(0, 3)).toEqual(['enqueue', 'save', 'navigate']);
    expect(screen.queryByText('Visit Article?')).toBeNull();
  });
  it('ignores rejected paths and executes a standalone treatment once', () => {
    const { widget } = fixture();
    render(<EmbedChatWidget {...widget} />);
    emit([reply([{ ...nav, target: { ...target, path: '//outside.example' } }, highlight])]);
    expect(widget.pageActions.navigate).not.toHaveBeenCalled();
    expect(widget.pageActions.execute).toHaveBeenCalledWith({ action: highlight });
    emit([reply([highlight])]);
    expect(widget.pageActions.execute).toHaveBeenCalledTimes(1);
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
  it('drains one queued treatment, cancels deferred execution and cleans highlight on unmount', () => {
    const { widget } = fixture();
    widget.session.drain = vi.fn(() => highlight);
    const cancel = vi.fn();
    let callback!: () => void;
    widget.scheduleFrame = ({ callback: next }) => { callback = next; return cancel; };
    const view = render(<EmbedChatWidget {...widget} />);
    expect(widget.session.drain).toHaveBeenCalledTimes(1);
    expect(widget.pageActions.execute).not.toHaveBeenCalled();
    act(() => callback());
    expect(widget.pageActions.execute).toHaveBeenCalledWith({ action: highlight });
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(widget.pageActions.clearHighlight).toHaveBeenCalledTimes(1);
  });
  it.each([null, { junk: true }, nav])('does not schedule a drained navigation or malformed entry: %j', entry => {
    const { widget } = fixture();
    widget.session.drain = () => entry;
    widget.scheduleFrame = vi.fn(() => () => {});
    render(<EmbedChatWidget {...widget} />);
    expect(widget.scheduleFrame).not.toHaveBeenCalled();
  });
  it('isolates transcripts and processed reply IDs between two widget instances', () => {
    const first = fixture();
    const second = fixture();
    const a = render(<EmbedChatWidget {...first.widget} />);
    const firstChange = pane.props!.onMessagesChange!;
    const b = render(<EmbedChatWidget {...second.widget} />);
    const secondChange = pane.props!.onMessagesChange!;
    act(() => firstChange([reply([nav])]));
    expect(first.widget.pageActions.navigate).toHaveBeenCalledTimes(1);
    expect(second.widget.pageActions.navigate).not.toHaveBeenCalled();
    act(() => secondChange([reply([nav])]));
    expect(second.widget.pageActions.navigate).toHaveBeenCalledTimes(1);
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
    expect(widget.pageActions.clearHighlight).toHaveBeenCalledTimes(1);
    element.remove();
  });
});
