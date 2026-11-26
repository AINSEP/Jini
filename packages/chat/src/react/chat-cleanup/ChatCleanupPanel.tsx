import { ChatCleanupDialog } from "../components/ChatCleanupDialog.js";

import type { ChatCleanupConfirm, WiredChatCleanup } from "./chat-cleanup.hooks.js";

/**
 * The dock's chat cleanup controls, beside the switcher: a toggle that turns on row ticking, the
 * 1–365 day chooser in front of `ChatCleanupDialog` (which shows the server's count, bytes and kept
 * reasons before anything is deleted), and "Delete selected", which asks `confirm` first. Holds no
 * state of its own; everything comes from the injected {@link WiredChatCleanup}.
 *
 * @param props.confirm - The admin confirm dialog; delete-selected waits for its visible answer.
 * @complexity O(k) in the number of kept chats the preview names.
 */
export function ChatCleanupPanel({ cleanup, confirm }: { cleanup: WiredChatCleanup; confirm: ChatCleanupConfirm }, _optional = {}) {
  const { Button } = cleanup.kit;
  const count = cleanup.selectedIds.length;
  return (
    <div className="assistant-chat-cleanup">
      <Button type="button" aria-expanded={cleanup.open} onClick={() => cleanup.setOpen(!cleanup.open)}>{cleanup.copy.open}</Button>
      {cleanup.open ? <div className="assistant-chat-cleanup__panel">
        <label>
          {cleanup.copy.olderThan}
          <input type="number" min={1} max={365} step={1} value={Number.isNaN(cleanup.olderThanDays) ? "" : cleanup.olderThanDays}
            onChange={(event) => cleanup.setOlderThanDays(event.currentTarget.valueAsNumber)} />
        </label>
        <ChatCleanupDialog useChatCleanup={cleanup.useDialog} kit={cleanup.kit} copy={cleanup.copy.dialog} onDone={() => cleanup.setOpen(false)} />
        <Button type="button" disabled={count === 0} onClick={() => { void cleanup.deleteSelected({ confirm }); }}>
          {cleanup.copy.deleteSelected({ count })}
        </Button>
        {cleanup.error ? <p role="alert">{cleanup.error}</p> : null}
      </div> : null}
    </div>
  );
}
