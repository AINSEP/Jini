import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../../../../react/kit.js";

/** D-34: track the live transcript, not just the mount-time history. Switching chats immediately
 * derives from that chat's initial messages, so a previous chat cannot hide the new greeting.
 */
export function useAssistantEmptyState(
  { paneKey, initialMessages, onMessagesChange }: {
    paneKey: string;
    /** Undefined while there is no saved history, which ChatPane also renders as an empty chat. */
    initialMessages?: readonly ChatMessage[] | undefined;
    onMessagesChange: (messages: ChatMessage[]) => void;
  },
  _optional: Record<string, never> = {},
) {
  const [live, setLive] = useState<{ paneKey: string; count: number } | null>(null);
  const onMessagesChangeRef = useRef(onMessagesChange);
  onMessagesChangeRef.current = onMessagesChange;
  const empty = (live?.paneKey === paneKey ? live.count : initialMessages?.length ?? 0) === 0;
  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    // ChatPane notifies from an effect that depends on this callback. Keep its identity stable
    // and identical counts inert so a parent render cannot trigger a render/notification loop.
    setLive((previous) => previous?.paneKey === paneKey && previous.count === messages.length
      ? previous : { paneKey, count: messages.length });
    onMessagesChangeRef.current(messages);
  }, [paneKey]);
  return { empty, handleMessagesChange };
}
