import type { ReactNode } from "react";
import type { KitChatTranslator } from "../../../react/kit.js";
import type { agentHandle } from "@jini-ai/core/agent-handles";

import type { useMessageOverflowModal } from "./MessageOverflowModal.hooks.js";

/**
 * @file The chat pane's "Show in modal" surface (owner request, chat-overflow fix 2026-08-30):
 * *"if we have a UI element that we can't really show in the chat very well, I want to have a
 * 'show in modal' button that brings up a modal and shows the whole table / the whole UI."*
 *
 * Built on the native `<dialog>` element (`showModal()`/`close()`), the same foundation
 * `ImagePreviewModal.tsx` already uses in this app and `@jini-ai/admin/react`'s `ConfirmDialog`
 * uses upstream — reusing the established dialog PATTERN rather than inventing a second one, per
 * this feature's own review note ("do not introduce a new dialog pattern"). Not built on
 * `ImagePreviewModal` or `ConfirmDialog` directly: both have a fixed content shape (an `<img>`; a
 * title+body+two-button confirm/cancel pair) neither of which fits "arbitrary chat content at full
 * size" — same reasoning `ImagePreviewModal.tsx`'s own doc gives for not forcing image content
 * through `ConfirmDialog`'s contract. `children` here is a plain `ReactNode` on purpose, so any
 * host content — the re-rendered markdown text, a second `McpUiSurfaceCard` instance, a future
 * content type — can be shown full-size without this component needing to know its shape.
 *
 * A generic host-agnostic modal (not `@jini-ai/chat`'s own component) because the injection point
 * for it differs by content type: `OverflowAwareMcpUiSurfaceCard.tsx` renders one directly, and any
 * future per-message-content affordance (see that file's own doc for why plain markdown text isn't
 * wired up yet) would render one the same way.
 */
export interface MessageOverflowModalProps {
  open: boolean;
  /** The dialog's accessible name — read by assistive tech since this content has no visible page
   *  heading of its own inside the dialog. */
  title: string;
  onClose: () => void;
  /** Only rendered while `open` — callers should pass `null`/`undefined` when closed rather than an
   *  always-mounted element, so content with real side effects (a second live MCP-UI iframe
   *  session) is never mounted until the dialog actually opens. See
   *  `OverflowAwareMcpUiSurfaceCard.tsx` for the concrete case this matters for. */
  children: ReactNode;
  /** The dialog's open/close lifecycle: the host passes the real {@link useMessageOverflowModal};
   *  a test can pass a fake here to exercise this component's rendering without a real `<dialog>`
   *  lifecycle. Required, never defaulted: every hook reaches this package's components injected. */
  useModal: typeof useMessageOverflowModal;
  /** Publishes the close button as agent-addressable: the handle plus the host's `agentHandle()`
   *  tagger (`@jini-ai/core/agent-handles`), injected so this component imports no implementation.
   *  Omit to leave it untagged — every existing render then stays byte-identical. */
  agentHandle?: { handle: string; agentHandle: typeof agentHandle };
  /** The host's chat translator hook (the kit chat `useT`). */
  useTHook: () => KitChatTranslator;
}

export function MessageOverflowModal({
  open,
  title,
  onClose,
  children,
  useModal,
  agentHandle: tagging,
  useTHook,
}: MessageOverflowModalProps) {
  const t = useTHook();
  const { dialogRef, handleNativeCancel, handleBackdropClick } = useModal({ open, onClose });

  return (
    <dialog
      ref={dialogRef}
      className="jini-message-overflow-modal"
      aria-label={title}
      onCancel={handleNativeCancel}
      onClick={handleBackdropClick}
    >
      <button
        type="button"
        className="jini-message-overflow-modal-close"
        onClick={onClose}
        aria-label={t("Close")}
        {...(tagging ? tagging.agentHandle({ handle: tagging.handle }, { role: "button", label: t("Close") }) : {})}
      >
        ×
      </button>
      <div className="jini-message-overflow-modal-body">{children}</div>
    </dialog>
  );
}
