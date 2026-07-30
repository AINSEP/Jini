/**
 * @module ChatFab
 *
 * A draggable floating button that opens and closes a chat pane. This package ships unstyled
 * semantic markup (same convention as the rest of `@jini-ai/chat-react`) — a host supplies CSS
 * for the `chat-fab`/`chat-fab-open` classes.
 */
import { useChatFabDrag } from '../hooks/useChatFabDrag.js';

export interface ChatFabProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Rendered as the accessible name, and announced as a state change to assistive tech. */
  readonly label?: string;
}

export function ChatFab({ open, onToggle, label = 'chat' }: ChatFabProps) {
  const { buttonRef, position, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useChatFabDrag(onToggle);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`chat-fab${open ? ' chat-fab-open' : ''}`}
      // Not `onClick`: the pointer gesture already decides click-versus-drag, and keeping both
      // would fire the toggle twice on a tap.
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        // Pointer handling bypasses the implicit click, so keyboard activation is wired directly
        // — otherwise the button would be unusable without a mouse.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      style={position === null ? undefined : { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }}
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      /*
       * Deliberately NOT tagged with `data-agent-element`. A host that scopes its page driver to
       * content `<main>` won't advertise this handle, and it's a pointless capability anyway: an
       * agent reachable through the chat pane cannot usefully ask to un-hide the pane it is
       * already speaking through.
       */
    >
      <span aria-hidden="true">{open ? '×' : '💬'}</span>
    </button>
  );
}
