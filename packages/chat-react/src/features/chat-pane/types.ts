import type { CSSProperties, ReactNode } from 'react';
import type { ChatAttachment, ChatMessage } from '@jini/chat-core';

import type { ComposerSlots } from '../../slots.js';
import type { ChatTransport, RunContext } from '../../transport.js';

export interface ChatPaneAgentOption {
  id: string;
  label: string;
}

/**
 * Browser-safe runtime inventory consumed by the chat pane. This is
 * structurally compatible with the daemon's `AgentSummary` DTO without
 * coupling the React package to `@jini/http`.
 */
export interface ChatPaneAgent {
  id: string;
  name: string;
  available?: boolean;
  version?: string | null;
  authStatus?: 'ok' | 'missing' | 'unknown';
  models?: readonly ChatPaneAgentOption[];
  reasoningOptions?: readonly ChatPaneAgentOption[];
  supportsCustomModel?: boolean;
  diagnostic?: string;
}

export interface ChatPaneAgentSelection {
  agentId: string;
  model?: string;
  reasoning?: string;
}

/** Host I/O effects used by the package-owned runtime inventory controller. */
export interface ChatPaneRuntimeAccess {
  listAgents: () => Promise<readonly ChatPaneAgent[]>;
  rescanAgents: () => Promise<readonly ChatPaneAgent[]>;
  daemonOnline: () => Promise<boolean>;
}

export type ChatPaneActivity = 'unavailable' | 'ready' | 'queued' | 'streaming' | 'failed';
export type ChatPaneVariant = 'workspace';
export type RuntimePickerPlacement = 'up' | 'down';

/**
 * Native filesystem operations used by {@link ChatPane} to implement its
 * working-directory picker. The host provides effects only; current state,
 * recent-folder UI, validation, cancellation, and errors remain package-owned.
 *
 * @example
 * ```tsx
 * <ChatPane
 *   initialWorkingDirectory="/work/example"
 *   onChangeWorkingDirectory={(directory) => console.log(directory)}
 *   workingDirectoryAccess={desktopBridge}
 * />
 * ```
 */
export interface ChatPaneWorkingDirectoryAccess {
  /** Canonicalizes a trusted host-declared initial directory when supported. */
  normalizeWorkingDirectory?: (directory: string) => Promise<string | null>;
  /** Opens a native folder dialog and returns null when the user cancels. */
  pickWorkingDirectory: (currentDirectory?: string) => Promise<string | null>;
  /** Reads most-recently-used folders in most-recent-first order. */
  recentDirectories: () => Promise<readonly string[]>;
  /** Checks whether a selected or recent directory still exists. */
  directoryExists: (directory: string) => Promise<boolean>;
}

/** One daemon-relayed capability invocation the pane must execute and answer. */
export interface ChatPaneAgentToolAction {
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
}

/**
 * Host-supplied channel connecting this pane instance to a daemon-side transport (HTTP route, MCP
 * stdio server) that cannot reach browser state directly. `subscribe` is called once while agent
 * control is enabled; the host pushes each relayed action through its callback and the pane answers
 * via `respondSuccess`/`respondError`. Omit entirely to run WebMCP-only (no daemon relay).
 */
export interface ChatPaneAgentBridgeAccess {
  /** Starts listening for relayed actions; returns an unsubscribe function. */
  subscribe: (onAction: (action: ChatPaneAgentToolAction) => void) => () => void;
  respondSuccess: (invocationId: string, output: unknown) => Promise<void>;
  respondError: (invocationId: string, message: string) => Promise<void>;
}

/** Enables the chat pane's agent-control surface (`agent-tools.ts`'s `CHAT_PANE_AGENT_TOOLS`). */
export interface ChatPaneAgentControlOptions {
  /** Defaults to `false` — agent control is opt-in. */
  enabled?: boolean;
  /** Wires the daemon-relayed transports (HTTP route table, MCP stdio server) in addition to in-page WebMCP. */
  bridgeAccess?: ChatPaneAgentBridgeAccess;
}

export interface ChatPaneRunContextInput {
  prompt: string;
  selection: ChatPaneAgentSelection;
  workingDirectory: string | null;
}

export type ChatPaneRunContext =
  | RunContext
  | ((input: ChatPaneRunContextInput) => RunContext | undefined);

export interface ChatPaneProps {
  transport: ChatTransport;
  agents?: readonly ChatPaneAgent[];
  /** Optional host effects for package-owned inventory, rescan, and health polling. */
  runtimeAccess?: ChatPaneRuntimeAccess;
  runtimeStatusPollMs?: number;
  title?: string;
  variant?: ChatPaneVariant;
  initialMessages?: ChatMessage[];
  conversationId?: string | null;
  initialSelection?: ChatPaneAgentSelection;
  selection?: ChatPaneAgentSelection;
  onSelectionChange?: (selection: ChatPaneAgentSelection) => void;
  runContext?: ChatPaneRunContext;
  /** Opt-in agent-control surface: WebMCP tool registration plus, when `bridgeAccess` is supplied, the daemon-relayed transports. */
  agentControl?: ChatPaneAgentControlOptions;
  onActivityChange?: (activity: ChatPaneActivity) => void;
  onRescanAgents?: () => void;
  scanningAgents?: boolean;
  daemonOnline?: boolean;
  executionMode?: 'local' | 'api';
  apiModeAvailable?: boolean;
  onExecutionModeChange?: (mode: 'local' | 'api') => void;
  initialDraft?: string;
  placeholder?: string;
  suggestions?: readonly string[];
  /** Controlled working-directory value. */
  workingDirectory?: string | null;
  /** Initial value used when `workingDirectory` is uncontrolled. */
  initialWorkingDirectory?: string | null;
  /** Reports a package-owned picker, recent-folder, or clear selection. */
  onChangeWorkingDirectory?: (workingDirectory: string | null) => void;
  /** Optional native filesystem effects used by the package-owned picker. */
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess;
  projectFileNames?: ReadonlySet<string>;
  uploadAttachments?: (
    files: File[],
    options?: ChatPaneAttachmentUploadOptions,
  ) => Promise<ChatAttachment[]>;
  attachmentAccept?: string;
  disabled?: boolean;
  runtimePickerPlacement?: RuntimePickerPlacement;
  composerSlots?: Omit<ComposerSlots, 'footerAccessories'>;
  header?: ReactNode;
  leadingAccessory?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface ChatPaneAttachmentUploadOptions {
  /** Aborted when the composer resets, the pane unmounts, or the upload is superseded. */
  signal: AbortSignal;
  /** Stable identifier shared by uploads staged for the same composer turn. */
  batchId: string;
}

export interface AgentRuntimePickerProps {
  agents: readonly ChatPaneAgent[];
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  onRescan?: () => void;
  scanning?: boolean;
  daemonOnline?: boolean;
  placement?: RuntimePickerPlacement;
  executionMode?: 'local' | 'api';
  apiModeAvailable?: boolean;
  onExecutionModeChange?: (mode: 'local' | 'api') => void;
  agentIconBasePath?: string;
}
