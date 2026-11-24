/**
 * Types for the conversation-chat-pane feature: the three host hooks it requires (structural, so a
 * host's own hooks fit without importing anything from here), the injected copy, and the state the
 * pane's hook hands its markup.
 */
import type { ComponentType, Dispatch, DragEvent, RefObject, SetStateAction } from 'react';
import type { ConversationListItem, ConversationListProps } from '../../components/ConversationList.js';
import type { ChatPaneComposerHandle, ChatPaneProps } from '../chat-pane/index.js';

/** What the host's `useTransport` returns. Every member is `undefined` without a host bridge. */
export interface ConversationChatPaneTransport {
  transport: ChatPaneProps['transport'] | undefined;
  runtimeAccess: ChatPaneProps['runtimeAccess'];
  workingDirectoryAccess: ChatPaneProps['workingDirectoryAccess'];
  /** The host's dropped-file path lookup; `undefined` leaves every drop to `ChatPane`. */
  getPathForFile: ((file: File) => string) | undefined;
  uploadAttachments: ChatPaneProps['uploadAttachments'];
}

/** What the host's `useConversations` returns: the persisted threads and the open one. */
export interface ConversationChatPaneConversations {
  conversations: readonly ConversationListItem[];
  activeId: string | null;
  /**
   * `ChatPane`'s `key`, deliberately not `activeId`: `activeId` also moves when an untitled pane
   * adopts a freshly created conversation mid-turn, and re-keying on that would remount the pane
   * out from under the reply it is streaming. `paneKey` changes only on a real switch.
   */
  paneKey: string;
  initialMessages: NonNullable<ChatPaneProps['initialMessages']>;
  select: (id: string) => void;
  create: () => void | Promise<void>;
  remove: (id: string) => void | Promise<void>;
  rename: (id: string, title: string) => void | Promise<void>;
  onMessagesChange: NonNullable<ChatPaneProps['onMessagesChange']>;
}

/** What the host's `useDeleteConfirmation` returns: an inline (never native-modal) delete confirm. */
export interface ConversationChatPaneDeleteConfirmation {
  /** The title asking to be confirmed, or `null` when nothing is pending. */
  pendingTitle: string | null;
  /** `ConversationList`'s `confirmDelete`; resolves when the inline confirmation is answered. */
  confirmDelete: (item: ConversationListItem) => boolean | Promise<boolean>;
  /** Answers the pending confirmation, if any. */
  resolvePending: (input: { confirmed: boolean }) => void;
}

/** The three host hooks. Required, with no defaults: each must keep its call position stable. */
export interface ConversationChatPaneHooks {
  useTransport: () => ConversationChatPaneTransport;
  useConversations: () => ConversationChatPaneConversations;
  useDeleteConfirmation: () => ConversationChatPaneDeleteConfirmation;
}

/** Every visible string the pane renders. The pane ships no default copy. */
export interface ConversationChatPaneLabels {
  /** The `<aside>`'s accessible name. */
  paneAriaLabel: string;
  /** The small line above the title. */
  eyebrow: string;
  title: string;
  /** The close button's visible glyph or text, and its accessible name. */
  close: string;
  closeAriaLabel: string;
  confirmDeleteAriaLabel: string;
  /** The inline delete prompt for the pending conversation's title. */
  deletePrompt: (input: { title: string }) => string;
  cancel: string;
  delete: string;
  /** Shown instead of the chat while the host has no transport or runtime access. */
  unavailable: string;
  /** The composer placeholder. */
  placeholder: string;
}

/** What the pane hands `ConversationList` and `ChatPane`, derived from the conversations hook. */
export interface ConversationListView {
  /** `ConversationList`'s `conversations` (a mutable copy of the readonly list). */
  listItems: ConversationListItem[];
  /** Spread onto `ChatPane`: `{}` while nothing is active, so no `conversationId` prop is passed. */
  conversationIdProp: { conversationId?: string };
}

export interface ConversationChatPaneState extends ConversationListView {
  transport: ConversationChatPaneTransport['transport'];
  runtimeAccess: ConversationChatPaneTransport['runtimeAccess'];
  workingDirectoryAccess: ConversationChatPaneTransport['workingDirectoryAccess'];
  uploadAttachments: ConversationChatPaneTransport['uploadAttachments'];
  conversations: ConversationChatPaneConversations;
  deleteConfirmation: ConversationChatPaneDeleteConfirmation;
  /** The working-directory picker's value. */
  workingDirectory: string | null;
  setWorkingDirectory: Dispatch<SetStateAction<string | null>>;
  /** Handed to `ChatPane`, which populates it once mounted. */
  composerHandle: RefObject<ChatPaneComposerHandle | null>;
  /** The `<aside>`'s capture-phase `onDropCapture` (`@jini-ai/ui/core` `captureFolderPathDrop`). */
  onDropCapture: (event: DragEvent<HTMLElement>) => void;
}

/** The two components the pane composes; omitted entries get this package's real ones. */
export interface ConversationChatPaneComponents {
  ConversationList?: ComponentType<ConversationListProps>;
  ChatPane?: ComponentType<ChatPaneProps>;
}

export interface ConversationChatPaneProps extends ConversationChatPaneHooks {
  onClose: () => void;
  labels: ConversationChatPaneLabels;
  variant?: ChatPaneProps['variant'];
  /** Added beside `jini-conversation-chat-pane` on the `<aside>`, for a host's own skin. */
  className?: string;
  /** Test/host seam for the composed chat components. */
  components?: ConversationChatPaneComponents;
}
