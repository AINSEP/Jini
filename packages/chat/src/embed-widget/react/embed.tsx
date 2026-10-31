import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatTransport } from '../../core/transport.js';
import { ChatPane } from '../../react/chat-pane.js';
import type { ChatPaneAgent } from '../../react/chat-pane.js';
import { ChatFab } from '../../react/components/ChatFab.js';
import { JiniChatProvider } from '../../react/components/JiniChatProvider.js';
import type { BrowserSessionStore } from '../browser/session-store.js';
import { EmbedChatHeader } from './header.js';
import { useEmbedChatSurface } from './dialog.hooks.js';
export { useEmbedChatDialog } from './dialog.hooks.js';
import type { EmbedHeaderCopy, EscapeKeyPort } from './header.js';
export { EmbedChatHeader } from './header.js';
export type { EmbedChatHeaderArgs, EmbedHeaderCopy, EscapeKeyPort } from './header.js';

export interface EmbedChatCopy extends EmbedHeaderCopy {
  readonly title: string;
  readonly fabLabel: string;
  readonly placeholder: string;
}
export interface EmbedChatWidgetArgs {
  readonly agent: ChatPaneAgent;
  readonly copy: EmbedChatCopy;
  readonly transport: ChatTransport;
  readonly session: BrowserSessionStore;
  readonly keyboard: EscapeKeyPort;
  /** Schedules after host layout; returns cancellation. No browser global is captured. */
  readonly scheduleFrame: (args: { callback: () => void }) => () => void;
}
const shellStyles = `
.jini-chat-embed__panel { position:fixed; right:var(--jini-embed-right,24px); bottom:var(--jini-embed-bottom,88px); width:min(var(--jini-embed-width,440px),calc(100vw - 32px)); height:min(var(--jini-embed-height,620px),calc(100dvh - 120px)); z-index:var(--jini-embed-z-index,1000); display:flex; flex-direction:column; }
.jini-chat-embed__panel[hidden] { display:none; }
.jini-chat-embed__panel > .jini-chat-pane { flex:1; min-height:0; }
.jini-chat-embed__reset-confirm { display:flex; align-items:center; gap:8px; }
`;
/**
 * Wires the existing pane/fab to per-instance transcript and transport ports.
 * Keep effect ports stable for the lifetime of a mounted widget; remount for a new
 * session/agent. Page control lives on the shared frontend bridge, so transcript rehydration
 * cannot replay effects. Reset remounts the pane after confirmation.
 * @complexity O(messages + latest reply events) per transcript update; O(message IDs) retained.
 */
export function EmbedChatWidget(args: EmbedChatWidgetArgs) {
  const { agent, copy, transport, session, keyboard } = args;
  const [initial] = useState(() => session.load({}));
  const [paneKey, setPaneKey] = useState(0);
  const { open, toggle, panelRef, launcherRef, panelId } = useEmbedChatSurface({ initialOpen: initial.open }, { resetKey: paneKey });
  const [messages, setMessages] = useState(initial.messages);
  useEffect(() => { session.save({ state: { open, messages } }); }, [session, open, messages]);
  const reset = useCallback(() => {
    session.clear({});
    setMessages([]);
    setPaneKey(key => key + 1);
  }, [session]);
  const onMessagesChange = useCallback((next: ChatMessage[]) => { setMessages(next); }, []);
  return <div className="jini-chat-embed">
    <style>{shellStyles}</style>
    <div ref={launcherRef} tabIndex={-1}>
      <ChatFab open={open} onToggle={toggle} aria-label={copy.fabLabel} label={copy.fabLabel} aria-controls={panelId} aria-haspopup="dialog" />
    </div>
    <JiniChatProvider transport={transport}>
      <div id={panelId} className="jini-chat-embed__panel" hidden={!open} ref={panelRef} role="dialog" aria-modal="true" aria-label={copy.title}>
        <ChatPane key={paneKey} transport={transport} agents={[agent]} initialSelection={{ agentId: agent.id }}
          initialMessages={messages} title={copy.title} placeholder={copy.placeholder} variant="embed"
          header={<EmbedChatHeader title={copy.title} hasMessages={messages.length > 0} onReset={reset} copy={copy} keyboard={keyboard} />}
          onMessagesChange={onMessagesChange} />

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
