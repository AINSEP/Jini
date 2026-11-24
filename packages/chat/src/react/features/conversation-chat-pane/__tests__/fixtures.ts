/** Shared fakes for the conversation-chat-pane tests: the three host hooks and a labels set. */
import { captureFolderPathDrop } from '@jini-ai/ui/core';
import type {
  ConversationChatPaneConversations,
  ConversationChatPaneDeleteConfirmation,
  ConversationChatPaneLabels,
  ConversationChatPaneTransport,
} from '../types.js';

export interface PaneFakes {
  connected?: boolean;
  pendingTitle?: string | null;
  getPathForFile?: (file: File) => string;
}

/** The three host hooks, recording every callback the pane's controls reach into `calls`. */
export function fakeHooks({ connected = true, pendingTitle = null, getPathForFile }: PaneFakes = {}) {
  const calls: string[] = [];
  const runtimeAccess = { listAgents: async () => [], rescanAgents: async () => [], daemonOnline: async () => false };
  const transport = {
    transport: connected ? { name: 'fleet' } : undefined,
    runtimeAccess: connected ? runtimeAccess : undefined,
    workingDirectoryAccess: undefined,
    getPathForFile,
    uploadAttachments: async () => [],
  } as unknown as ConversationChatPaneTransport;
  const conversations = {
    conversations: [{ id: 'c1', title: 'Fleet triage' }, { id: 'c2', title: 'Deploy check' }],
    activeId: 'c1',
    paneKey: 'c1',
    initialMessages: [],
    select: (id: string) => void calls.push(`select:${id}`),
    create: () => void calls.push('create'),
    remove: (id: string) => void calls.push(`remove:${id}`),
    rename: (id: string, title: string) => void calls.push(`rename:${id}:${title}`),
    onMessagesChange: () => {},
  } as unknown as ConversationChatPaneConversations;
  const deleteConfirmation: ConversationChatPaneDeleteConfirmation = {
    pendingTitle,
    confirmDelete: async () => false,
    resolvePending: ({ confirmed }) => void calls.push(`resolve:${confirmed}`),
  };
  // The real folder-drop rule a host injects, so the drop tests exercise the composed behaviour.
  const hooks = { useTransport: () => transport, useConversations: () => conversations, useDeleteConfirmation: () => deleteConfirmation, captureFolderDrop: captureFolderPathDrop };
  return { hooks, calls, transport, conversations, deleteConfirmation, runtimeAccess };
}

/** Distinctive copy, so a test can tell injected strings from anything built in. */
export const LABELS: ConversationChatPaneLabels = {
  paneAriaLabel: 'L-pane',
  eyebrow: 'L-eyebrow',
  title: 'L-title',
  close: 'L-x',
  closeAriaLabel: 'L-close',
  confirmDeleteAriaLabel: 'L-confirm',
  deletePrompt: ({ title }) => `L-delete-prompt:${title}`,
  cancel: 'L-cancel',
  delete: 'L-delete',
  unavailable: 'L-unavailable',
  placeholder: 'L-placeholder',
};

/** A `DragEvent`-shaped drop of one folder whose path `getPathForFile` reads off `file.path`. */
export function folderDrop({ path }: { path: string }, calls: string[] = []) {
  return {
    dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }], files: [{ path }] },
    preventDefault: () => void calls.push('preventDefault'),
    stopPropagation: () => void calls.push('stopPropagation'),
  };
}

export const pathOf = (file: File) => (file as unknown as { path: string }).path;
