import type { ReactNode } from 'react';
import { useEmbedChatHeader } from './header.hooks.js';

export interface EmbedHeaderCopy {
  readonly eyebrow: string;
  readonly newThread: string;
  readonly cancel: string;
  readonly discard: string;
}
export interface EscapeKeyPort { subscribe(args: { onEscape: () => void }): () => void }
export interface EmbedChatHeaderArgs {
  readonly title: string;
  readonly hasMessages: boolean;
  readonly onReset: () => void;
  readonly copy: EmbedHeaderCopy;
  readonly keyboard: EscapeKeyPort;
  readonly closeAction?: ReactNode;
}
/** Two-step reset with safe initial focus, Cancel and host-wide Escape. O(1) state and listeners. */
export function EmbedChatHeader({ title, hasMessages, onReset, copy, keyboard, closeAction }: EmbedChatHeaderArgs) {
  const { confirming, cancel, requestReset, confirmReset, headerRef, resetButtonRef } = useEmbedChatHeader({ hasMessages, onReset, keyboard });
  return <div className="jini-chat-pane__header" ref={headerRef}>
    <div className="jini-chat-pane__heading">
      {copy.eyebrow && <span className="jini-chat-pane__eyebrow">{copy.eyebrow}</span>}
      <h2 className="jini-chat-pane__title">{title}</h2>
    </div>
    {confirming ? <div className="jini-chat-embed__reset-confirm">
      <button type="button" className="jini-chat-embed__reset-cancel" autoFocus onClick={cancel}>{copy.cancel}</button>
      <button type="button" className="jini-chat-pane__new-thread" onClick={confirmReset}>{copy.discard}</button>
    </div> : <button type="button" className="jini-chat-pane__new-thread" ref={resetButtonRef} onClick={requestReset}>{copy.newThread}</button>}
    {closeAction}
  </div>;
}
