/**
 * Everything `ConversationChatPane` holds and every handler it hands its markup, so the component
 * itself is markup only.
 */
import { useCallback, useRef, useState, type DragEvent } from 'react';
import type { ChatPaneComposerHandle } from '../../chat-pane/index.js';
import { conversationListView } from '../rules.js';
import type { ConversationChatPaneInput, ConversationChatPaneState } from '../types.js';

/**
 * The pane's state. The hooks run in a fixed order — transport, conversations, delete
 * confirmation, then the pane's own state, ref and drop callback — so no hook's position moves.
 */
export function useConversationChatPane(
  { useTransport, useConversations, useDeleteConfirmation, captureFolderDrop }: ConversationChatPaneInput,
  _optional: Record<string, never> = {},
): ConversationChatPaneState {
  const { transport, runtimeAccess, workingDirectoryAccess, getPathForFile, uploadAttachments } = useTransport();
  const conversations = useConversations();
  const deleteConfirmation = useDeleteConfirmation();
  // The working-directory picker (native folder dialog + MRU list) — unrelated to, and untouched
  // by, the drop handler below. A folder drop does not feed this: its path goes into the draft as text.
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);
  // Populated by `ChatPane` itself once mounted (`ChatPaneComposerHandle`). The seam the folder
  // drop uses to write a dropped folder's path into the draft as text.
  const composerHandle = useRef<ChatPaneComposerHandle | null>(null);
  const onDropCapture = useCallback(
    // Folder drop: the injected rule (`@jini-ai/ui/core` `captureFolderPathDrop`), port = the host's `getPathForFile`,
    // composer = `ChatPane`'s `composerHandle`; quoted when a path has whitespace. Capture phase so
    // a dropped folder yields a path, not an upload: `ChatPane`'s own bubble-phase drop handler
    // would expand the folder into leaf files and lose the folder's own path.
    (event: DragEvent<HTMLElement>) => {
      captureFolderDrop({ event, port: getPathForFile === undefined ? undefined : { getPathForFile }, composer: composerHandle });
    },
    [captureFolderDrop, getPathForFile],
  );

  return {
    transport,
    runtimeAccess,
    workingDirectoryAccess,
    uploadAttachments,
    conversations,
    deleteConfirmation,
    ...conversationListView(conversations),
    workingDirectory,
    setWorkingDirectory,
    composerHandle,
    onDropCapture,
  };
}
