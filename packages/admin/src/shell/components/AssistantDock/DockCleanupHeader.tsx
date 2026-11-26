import { DockHeader, type DockConversationTools, type DockHeaderProps } from "./DockHeader.js";

import type { ChatCleanupPanel } from "@jini-ai/chat/react/chat-cleanup/ChatCleanupPanel";

import type { WiredChatCleanup } from "@jini-ai/chat/react/chat-cleanup/chat-cleanup.hooks";

export interface DockCleanupHeaderProps extends Omit<DockHeaderProps, "conversationTools"> {
  readonly ChatCleanupPanel: typeof ChatCleanupPanel;
  /** Required, no default: the switcher's list hooks, pins, selection and cleanup (`useDockChatCleanup` in the app). */
  readonly useChatCleanup: (required: { t: DockHeaderProps["t"]; locale: string; untitled: string }) => WiredChatCleanup;
}

/**
 * The dock header `DockChatPane` mounts: `@jini-ai/admin`'s `DockHeader` with the P11 chat cleanup
 * fed through its `conversationTools` slot — the switcher gets the cleanup's list hooks, pinning and
 * row ticking, and `ChatCleanupPanel` sits beside it. Delete-selected waits on the same admin
 * confirm dialog as the switcher's own delete.
 *
 * @returns The Jini header with the cleanup mounted.
 * @complexity O(1) beyond `DockHeader`'s own render.
 */
export function DockCleanupHeader({ ChatCleanupPanel, useChatCleanup, ...header }: DockCleanupHeaderProps, _optional = {}) {
  const chatCleanup = useChatCleanup({ t: header.t, locale: header.locale, untitled: header.chatI18n.t("Untitled") });
  const conversationTools: DockConversationTools = {
    listProps: {
      hooks: chatCleanup.listHooks,
      onTogglePin: chatCleanup.togglePin,
      selectable: chatCleanup.open,
      selectedIds: chatCleanup.selectedIds,
      onSelectionChange: chatCleanup.select,
    },
    visibleConversations: chatCleanup.visibleConversations,
    accessory: <ChatCleanupPanel cleanup={chatCleanup} confirm={header.conversationDelete.confirm} />,
  };
  return <DockHeader {...header} conversationTools={conversationTools} />;
}
