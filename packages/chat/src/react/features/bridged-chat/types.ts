/**
 * @file Structural ports for a chat pane whose host reaches its agent runtime, working directories
 * and attachment staging through one injected bridge object (an Electron preload bridge, typically)
 * instead of HTTP. A host's own bridge satisfies these as-is.
 */
import type {
  ChatPaneProps,
  ChatPaneRuntimeAccess,
  ChatPaneWorkingDirectoryAccess,
} from '../chat-pane/types.js';

/** Writes one file's bytes into the host's staging area and answers with the staged absolute path. */
export interface AttachmentStagingPort {
  /** `name` is the `File`'s original name; a host derives at most an extension from it, never a path. */
  saveChatAttachment: (input: { name: string; data: ArrayBuffer }) => Promise<{ path: string }>;
}

/** The slice of a host bridge {@link useBridgedChatTransport} reads. */
export interface ChatBridgePort extends AttachmentStagingPort {
  listAgents: ChatPaneRuntimeAccess['listAgents'];
  rescanAgents: ChatPaneRuntimeAccess['rescanAgents'];
  daemonOnline: ChatPaneRuntimeAccess['daemonOnline'];
  normalizeWorkingDirectory: (required: { directory: string }) => Promise<string | null>;
  pickWorkingDirectory: (required: Record<string, never>, options?: { currentDirectory?: string }) => Promise<string | null>;
  recentWorkingDirectories: ChatPaneWorkingDirectoryAccess['recentDirectories'];
  workingDirectoryExists: (required: { directory: string }) => Promise<boolean>;
  /** Resolves a dropped/picked `File` to its absolute path without a round trip. */
  getPathForFile: (file: File) => string;
}

/** A run transport built on the bridge. Construction may install a listener, which `dispose` removes. */
export interface DisposableChatTransport {
  dispose: () => void;
}

/** What {@link useBridgedChatTransport} hands a chat pane. Every field is `undefined` without a bridge. */
export interface BridgedChatTransport<TTransport extends DisposableChatTransport = DisposableChatTransport> {
  transport: TTransport | undefined;
  runtimeAccess: ChatPaneRuntimeAccess | undefined;
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  /** `undefined` only when the bridge itself is. See {@link ChatBridgePort.getPathForFile}. */
  getPathForFile: ((file: File) => string) | undefined;
  /** `undefined` only when the bridge itself is. See `createStagedAttachmentUploader`. */
  uploadAttachments: ChatPaneProps['uploadAttachments'];
}
