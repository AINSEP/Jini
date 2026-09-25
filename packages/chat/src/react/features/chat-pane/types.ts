import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { ChatAttachment, ChatMessage } from '@jini-ai/chat';

import type { ComposerSlots } from '../../slots.js';
import type { ChatTransport, RunContext } from '@jini-ai/chat';

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
  /**
   * Whether this runtime can receive external MCP servers (Tovu/Jini tools) at all — mirrors
   * `@jini-ai/http-kit`'s `AgentSummary.supportsTools`, itself derived from
   * `@jini-ai/agent-runtime`'s `runtimeSupportsExternalTools(def)`. `AgentRuntimePicker` reads this
   * to show a "No tools" badge; `undefined` (a host on an older wire payload) is treated the same
   * as `true` — no badge — since there is no signal either way.
   */
  supportsTools?: boolean;
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
  /**
   * Registers this pane's own actions with the in-page WebMCP surface (`document.modelContext`).
   * Defaults to `false`; forwarded verbatim to `useChatPaneAgentControl`'s own `webmcp` option — see
   * that hook's doc for why the default is a security position, not caution, and kept separate from
   * `enabled`/`bridgeAccess` rather than implied by them.
   */
  webmcp?: boolean;
}

export interface ChatPaneRunContextInput {
  prompt: string;
  selection: ChatPaneAgentSelection;
  workingDirectory: string | null;
}

export type ChatPaneRunContext =
  | RunContext
  | ((input: ChatPaneRunContextInput) => RunContext | undefined);

/**
 * Imperative access to the composer's draft text — published on `composerHandle.current` by
 * `ChatPane` itself once mounted (`null` before mount and after unmount).
 */
export interface ChatPaneComposerHandle {
  /**
   * Appends `text` to whatever the operator has already typed (same joining rule the "+" discovery
   * menu's `insertText` items use — see `appendComposerDiscovery`), rather than replacing the draft
   * outright. This is the seam for a host that needs to write into the draft AFTER first render —
   * `initialDraft` only seeds the very first one and cannot be written to again, and `ChatPane`
   * exposes no other prop for pushing text into an in-progress draft from outside.
   */
  insertText: (text: string) => void;
}

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
  /**
   * Confirms which previously staged attachments still exist, so a draft restored after a reload
   * never shows a chip for a file the backend has since garbage-collected — that looks intact and
   * then fails at send. Receives the cached references, returns the subset still valid; a rejection
   * is treated as "none survived".
   *
   * **Optional, and omitting it keeps the previous behavior exactly**: attachment persistence stays
   * off, nothing is written and nothing is restored, and only the draft TEXT survives a reload. No
   * existing host needs to change anything. Wire it only if the host can actually answer the
   * liveness question — restoring references it cannot vouch for is the failure this prevents.
   */
  validateAttachments?: (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]>;
  /**
   * A ref `ChatPane` populates with a `ChatPaneComposerHandle` once mounted, for a host that needs
   * to insert text into the draft from OUTSIDE this component's own props — e.g. an absolute path
   * a desktop host recovered from a native drag-drop event and could not have known at
   * `initialDraft`-seeding time. `null` before mount and after unmount; a host calling `.insertText`
   * before the pane exists has nothing to call.
   */
  composerHandle?: RefObject<ChatPaneComposerHandle | null>;
  placeholder?: string;
  /**
   * Rotating composer suggestions, cycled every few seconds in place of one fixed `placeholder` —
   * see `useChatPaneComposerPlaceholder`. Takes over from `placeholder` once it has two or more
   * entries; a single-entry list (or `prefers-reduced-motion: reduce`) shows that one entry with no
   * rotation. `placeholder` keeps resolving exactly as before when this is omitted or empty, so
   * this is additive — no existing host needs to change anything.
   */
  placeholders?: readonly string[];
  suggestions?: readonly string[];
  /** Controlled working-directory value. */
  workingDirectory?: string | null;
  /** Initial value used when `workingDirectory` is uncontrolled. */
  initialWorkingDirectory?: string | null;
  /** Reports a package-owned picker, recent-folder, or clear selection. */
  onChangeWorkingDirectory?: (workingDirectory: string | null) => void;
  /** Optional native filesystem effects used by the package-owned picker. */
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess;
  /**
   * Where the working-directory control renders when `workingDirectoryAccess` is supplied.
   * Ignored when `workingDirectoryAccess` is absent — that case always uses the composer's own
   * lightweight text-input popover, regardless of this prop.
   *
   * - `'below'` (default): the package's own `WorkingDirPicker` renders beneath the composer, as
   *   it always has. Existing hosts (e.g. the reference-web example's desktop bridge) that never
   *   set this prop keep this exact behavior unchanged.
   * - `'composer'`: the control moves into the composer's action row instead, next to the
   *   attach/discovery button — clicking it calls `workingDirectoryAccess.pickWorkingDirectory`
   *   directly (the native OS dialog IS the picker, so there is no popover to open). Nothing
   *   renders below the composer in this mode. Opt in when a host wants a single working-directory
   *   control living next to "+" rather than two competing ones.
   * - `'none'`: no working-directory control renders anywhere — not the composer's folder icon,
   *   not the below-composer `WorkingDirPicker`. Opt in when a host has no real filesystem path to
   *   offer (e.g. a browser context where a directory picker can only ever yield a folder name, not
   *   a path the agent runtime can use) and a non-functional control would be worse than none.
   *
   * @default 'below'
   */
  workingDirectoryControlPlacement?: 'below' | 'composer' | 'none';
  projectFileNames?: ReadonlySet<string>;
  uploadAttachments?: (
    files: File[],
    options?: ChatPaneAttachmentUploadOptions,
  ) => Promise<ChatAttachment[]>;
  attachmentAccept?: string;
  disabled?: boolean;
  runtimePickerPlacement?: RuntimePickerPlacement;
  /**
   * `footerAccessories` AND `leadingAccessories` are both excluded here for the same reason:
   * `ChatPane` itself always owns both ends of the composer's slot row. The footer is always the
   * `AgentRuntimePicker` (see `slots` assembly below); the leading, pinned-context zone is always
   * assembled from this interface's own {@link leadingAccessory} prop. A `composerSlots` value
   * carrying either key used to type-check but silently lose the value at runtime — `ChatPane`'s
   * `slots` object always overwrote both keys unconditionally — so this `Omit` turns that dead end
   * into a compile error instead of a debugging session.
   */
  composerSlots?: Omit<ComposerSlots, 'footerAccessories' | 'leadingAccessories'>;
  header?: ReactNode;
  /**
   * Content for the composer's pinned-context zone — the space above the input that a host
   * populates with whatever it wants pinned there (selected plugins, MCP servers, anything else),
   * and which Jini renders and animates as a first-class part of the composer control (see
   * `CHAT_PANE_STYLES`'s `.jini-composer-leading` rules). `undefined`/`null` renders nothing at
   * all, so an idle composer reserves no space for this zone.
   */
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
