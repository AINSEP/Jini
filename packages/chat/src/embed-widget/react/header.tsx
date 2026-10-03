import { useEffect, useState } from 'react';

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
}
/** Two-step reset with safe initial focus, Cancel and host-wide Escape. O(1) state and listeners. */
export function EmbedChatHeader({ title, hasMessages, onReset, copy, keyboard }: EmbedChatHeaderArgs) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    return keyboard.subscribe({ onEscape: () => setConfirming(false) });
  }, [confirming, keyboard]);
  return <div className="jini-chat-pane__header">
    <div className="jini-chat-pane__heading">
      <span className="jini-chat-pane__eyebrow">{copy.eyebrow}</span>
      <h2 className="jini-chat-pane__title">{title}</h2>
    </div>
    {confirming ? <div className="jini-chat-embed__reset-confirm">
      <button type="button" className="jini-chat-embed__reset-cancel" autoFocus onClick={() => setConfirming(false)}>{copy.cancel}</button>
      <button type="button" className="jini-chat-pane__new-thread" onClick={() => { setConfirming(false); onReset(); }}>{copy.discard}</button>
    </div> : <button type="button" className="jini-chat-pane__new-thread" onClick={() => {
      if (hasMessages) setConfirming(true); else onReset();
    }}>{copy.newThread}</button>}
  </div>;
}
