import { useMemo } from "react";
import type { AssistantChatsPort } from "../../../hooks/assistant-chats-port.hooks.js";

/** Binds the selected admin chat's existing loader and browser event ports; Jini owns refresh and disposal.
 * The host passes its chats port (the loader it binds for the dock). */
export function useConversationRefreshSignal(
  { conversationId, port }: { conversationId: string | null; port: Pick<AssistantChatsPort, "loadMessages"> },
  { visibility = document, focus = window }: { visibility?: EventTarget & { readonly visibilityState: string }; focus?: EventTarget } = {},
) {
  return useMemo(() => conversationId ? { loadMessages: () => port.loadMessages({ conversationId }), visibility, focus } : undefined, [conversationId, port, visibility, focus]);
}
