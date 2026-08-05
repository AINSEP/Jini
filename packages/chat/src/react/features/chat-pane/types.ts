import type { CSSProperties, ReactNode } from 'react';
import type { ChatAttachment, ChatMessage } from '@jini-ai/chat/core';

import type { ComposerSlots } from '../../slots.js';
import type { ChatTransport, RunContext } from '@jini-ai/chat/core';

export interface ChatPaneAgentOption {
  id: string;
  label: string;
}

/**
 * Browser-safe runtime inventory consumed by the chat pane. This is
 * structurally compatible with the daemon's `AgentSummary` DTO without
 * coupling the React package to `@jini-ai/http-kit`.
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
  /** Fires with the full message list whenever it changes — the read side of an otherwise write-only pane, for a host that needs to inspect or test what the conversation actually contains. */
  onMessagesChange?: (messages: ChatMessage[]) => void;
  onRescanAgents?: () => void;
  scanningAgents?: boolean;
  daemonOnline?: boolean;
  executionMode?: 'local' | 'api';
  apiModeAvailable?: boolean;
  onExecutionModeChange?: (mode: 'local' | 'api') => void;
  /** Passed straight through to the runtime picker; see {@link ByokRuntimeSummary}. */
  byokRuntime?: ByokRuntimeSummary;
  /** Passed straight through to the runtime picker. */
  onByokModelChange?: (model: string) => void;
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

/**
 * What the host's BYOK credential actually resolves to, for the picker to report while
 * `executionMode` is `'api'`.
 *
 * Exists because the picker had no way to describe the API path at all. It knew only that the mode
 * was selectable (`apiModeAvailable`), so every label it rendered came from the detected CLI
 * inventory — a popover reading "Claude Code · Default model", offering a CLI agent list, a
 * "Default (CLI config)" model select and a Rescan PATH button, while the pane was in fact talking
 * to Gemini over an API key. None of those controls affect an API turn.
 *
 * Optional, and the picker degrades honestly without it — unnamed provider, no model line — rather
 * than falling back to CLI labels, which would restate the same wrong claim.
 */
export interface ByokRuntimeSummary {
  /** Human-readable provider name, e.g. `'Google Gemini'`. Usually a `ProviderPreset.title`. */
  providerLabel?: string;
  /** The configured model id, e.g. `'gemini-2.5-flash-lite'`. */
  model?: string;
  /**
   * Brand-mark id for `AgentIcon`, e.g. `'gemini'`.
   *
   * Host-supplied rather than derived here from `providerLabel`, because which brand assets exist
   * is a fact about the HOST's asset directory (`agentIconBasePath`), not about the provider. A
   * package-side guess would render a broken image for any host that ships a different set.
   * Omitted means "no mark available", and the picker falls back to a generic API glyph rather
   * than to the selected CLI's logo, which would name the wrong runtime.
   */
  iconId?: string;
  /**
   * Models this credential can run — the same discovered list the host's own BYOK settings show.
   *
   * Supplying it (together with `onByokModelChange`) turns the model row into a real picker
   * writing back to the host's stored config, so the composer and the settings screen are two
   * views of one value. Omit for a read-only display.
   */
  models?: readonly { id: string; label: string }[];
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
  /** Read while `executionMode === 'api'`; ignored in `'local'`. */
  byokRuntime?: ByokRuntimeSummary;
  /** Persists a model chosen from the BYOK row. Supplying it (with `byokRuntime.models`) is what
   *  makes that row an editable picker rather than a read-only value. */
  onByokModelChange?: (model: string) => void;
  agentIconBasePath?: string;
}
