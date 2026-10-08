import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatMessage } from '../../core/messages.js';
import { isTerminalRunStatus } from '../../core/messages.js';
import type { ChatTransport } from '../../core/transport.js';
import { ChatPane } from '../../react/chat-pane.js';
import type { ChatPaneAgent } from '../../react/chat-pane.js';
import { ChatFab } from '../../react/components/ChatFab.js';
import { JiniChatProvider } from '../../react/components/JiniChatProvider.js';
import type { BrowserSessionStore } from '../browser/session-store.js';
import { extractPageActions, splitPageActions, isQueuedPageAction } from '../../core/browser/page-actions.js';
import type { NavigateAction, NonNavigateAction, PageActionPort } from '../../core/browser/page-actions.js';
import { EmbedChatHeader } from './header.js';
import type { EmbedHeaderCopy, EscapeKeyPort } from './header.js';
export { EmbedChatHeader } from './header.js';
export type { EmbedChatHeaderArgs, EmbedHeaderCopy, EscapeKeyPort } from './header.js';

export interface EmbedChatCopy extends EmbedHeaderCopy {
  readonly title: string;
  readonly fabLabel: string;
  readonly placeholder: string;
  readonly proposalLabel: (args: { title: string }) => string;
  readonly proposalGo: string;
}
export interface EmbedChatWidgetArgs {
  readonly agent: ChatPaneAgent;
  readonly copy: EmbedChatCopy;
  readonly transport: ChatTransport;
  readonly session: BrowserSessionStore;
  readonly pageActions: PageActionPort;
  readonly directiveEventName: string;
  readonly keyboard: EscapeKeyPort;
  /** Schedules after host layout; returns cancellation. No browser global is captured. */
  readonly scheduleFrame: (args: { callback: () => void }) => () => void;
}
interface PendingProposal { readonly navigate: NavigateAction; readonly bundled: NonNavigateAction | null }
const shellStyles = `
.jini-chat-embed__panel { position:fixed; right:var(--jini-embed-right,24px); bottom:var(--jini-embed-bottom,88px); width:min(var(--jini-embed-width,440px),calc(100vw - 32px)); height:min(var(--jini-embed-height,620px),calc(100dvh - 120px)); z-index:var(--jini-embed-z-index,1000); display:flex; flex-direction:column; }
.jini-chat-embed__panel[hidden] { display:none; }
.jini-chat-embed__panel > .jini-chat-pane { flex:1; min-height:0; }
.jini-chat-embed__reset-confirm,.jini-chat-embed__proposal { display:flex; align-items:center; gap:8px; }
.jini-chat-embed__proposal { padding:12px; background:var(--jini-embed-proposal-background,Canvas); color:var(--jini-embed-proposal-color,CanvasText); }
`;
/**
 * Wires the existing pane/fab to per-instance transcript and page-action ports.
 * Keep effect ports stable for the lifetime of a mounted widget; remount for a new
 * session/agent. Restored replies are marked processed before the pane mounts, so
 * rehydration cannot replay navigation. Reset remounts the pane after confirmation.
 * @complexity O(messages + latest reply events) per transcript update; O(message IDs) retained.
 */
export function EmbedChatWidget(args: EmbedChatWidgetArgs) {
  const { agent, copy, transport, session, pageActions, directiveEventName, keyboard, scheduleFrame } = args;
  const [initial] = useState(() => session.load({}));
  const [open, setOpen] = useState(initial.open);
  const [messages, setMessages] = useState(initial.messages);
  const [paneKey, setPaneKey] = useState(0);
  const [pending, setPending] = useState<PendingProposal | null>(null);
  const processed = useRef(new Set(initial.messages.map(message => message.id)));
  useEffect(() => { session.save({ state: { open, messages } }); }, [session, open, messages]);
  useEffect(() => {
    const queued = { value: session.drain({}) };
    if (!isQueuedPageAction(queued) || queued.value.type === 'navigate') return;
    const action = queued.value;
    return scheduleFrame({ callback: () => { pageActions.execute({ action }); } });
  }, [session, pageActions, scheduleFrame]);
  useEffect(() => () => pageActions.clearHighlight({}), [pageActions]);
  const reset = useCallback(() => {
    session.clear({});
    setMessages([]);
    setPaneKey(key => key + 1);
    setPending(null);
    processed.current.clear();
  }, [session]);
  const go = useCallback((proposal: PendingProposal, transcript: ChatMessage[]) => {
    if (!pageActions.allows({ action: proposal.navigate })) return;
    if (proposal.bundled && pageActions.allows({ action: proposal.bundled })) session.enqueue({ action: proposal.bundled });
    // Both writes must finish before the host navigation can tear down this page.
    session.save({ state: { open, messages: transcript } });
    pageActions.navigate({ action: proposal.navigate });
  }, [session, pageActions, open]);
  const onMessagesChange = useCallback((next: ChatMessage[]) => {
    setMessages(next);
    const latest = next.at(-1);
    if (!latest || latest.role !== 'assistant' || !isTerminalRunStatus({ status: latest.runStatus }) || processed.current.has(latest.id)) return;
    processed.current.add(latest.id);
    setPending(null);
    const actions = extractPageActions({ events: latest.events, directiveEventName })
      .filter(action => pageActions.allows({ action }));
    const { navigate, other } = splitPageActions({ actions });
    if (!navigate) { if (other) pageActions.execute({ action: other }); return; }
    const proposal = { navigate, bundled: other };
    if (navigate.auto) go(proposal, next); else setPending(proposal);
  }, [directiveEventName, pageActions, go]);
  return <div className="jini-chat-embed">
    <style>{shellStyles}</style>
    <ChatFab open={open} onToggle={() => setOpen(current => !current)} label={copy.fabLabel} />
    <JiniChatProvider transport={transport}>
      <div className="jini-chat-embed__panel" hidden={!open}>
        <ChatPane key={paneKey} transport={transport} agents={[agent]} initialSelection={{ agentId: agent.id }}
          initialMessages={messages} title={copy.title} placeholder={copy.placeholder} workingDirectoryControlPlacement="none"
          header={<EmbedChatHeader title={copy.title} hasMessages={messages.length > 0} onReset={reset} copy={copy} keyboard={keyboard} />}
          onMessagesChange={onMessagesChange} />
        {pending ? <div className="jini-chat-embed__proposal">
          <span>{copy.proposalLabel({ title: pending.navigate.target.title })}</span>
          <button type="button" onClick={() => { setPending(null); go(pending, messages); }}>{copy.proposalGo}</button>
        </div> : null}
      </div>
    </JiniChatProvider>
  </div>;
}
/** Mounts into a host-provided node and returns lifecycle cleanup. O(1) plus React rendering. */
export function mountEmbedChat({ element, widget }: { element: Element; widget: EmbedChatWidgetArgs }): { unmount: (args: Record<string, never>) => void } {
  const root = createRoot(element);
  root.render(<EmbedChatWidget {...widget} />);
  return { unmount: (_args: Record<string, never>) => root.unmount() };
}
