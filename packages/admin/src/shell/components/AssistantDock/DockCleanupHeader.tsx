import type { ComponentType } from "react";

import type { DockConversationTools, DockHeaderProps } from "./DockHeader.js";

/** The slice of the host's wired chat cleanup this header reads (structural: the host injects the
 *  cleanup hook and its panel, so this package carries no edge to the chat package). */
export interface DockChatCleanup {
  readonly listHooks: DockConversationTools["listProps"]["hooks"];
  readonly open: boolean;
  readonly selectedIds: readonly string[];
  readonly select: (required: { ids: string[] }) => void;
  readonly togglePin: (required: { id: string; pinned: boolean }) => void;
  readonly visibleConversations: DockConversationTools["visibleConversations"];
}

export interface DockCleanupHeaderProps<Cleanup extends DockChatCleanup> extends Omit<DockHeaderProps, "conversationTools"> {
  readonly DockHeader: ComponentType<DockHeaderProps>;
  readonly ChatCleanupPanel: ComponentType<{ cleanup: Cleanup; confirm: DockHeaderProps["conversationDelete"]["confirm"] }>;
  /** Required, no default: the switcher's list hooks, pins, selection and cleanup (`useDockChatCleanup` in the app). */
  readonly useChatCleanup: (required: { t: DockHeaderProps["t"]; locale: string; untitled: string }) => Cleanup;
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
export function DockCleanupHeader<Cleanup extends DockChatCleanup>({ DockHeader, ChatCleanupPanel, useChatCleanup, ...header }: DockCleanupHeaderProps<Cleanup>, _optional = {}) {
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
