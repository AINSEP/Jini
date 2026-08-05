/**
 * `@jini-ai/chat/react/chat-pane` — the canonical public surface for `ChatPane`, the one
 * product-like composition this package ships (REF-001 Step C, 2026-08-05).
 *
 * This subpath exists so a minimal-controller or non-React-preset host can depend on
 * `@jini-ai/chat/react` without pulling in `ChatPane` at all, and so `ChatPane` itself has a
 * package-boundary home distinct from the neutral engine surface — see
 * `ADS-memory/reports/refactor/2026-08-05-ref-001-steps-bcd-proposal.md` §1 and §5 (Step C) for
 * the full history: the original REF-001 finding wanted `ChatPane` removed from the generic
 * barrel entirely; Section 1 resolved instead to keep it exported and guard it (R10 in
 * `scripts/check-chatpane-public-surface.ts`, which treats *this* file as the public barrel to
 * check `features/chat-pane/**`'s reach against — update `barrelPath` there if this file ever
 * moves again).
 *
 * `@jini-ai/chat/react`'s own barrel (`index.ts`) re-exports these same names from here, marked
 * `@deprecated`, so every existing `import { ChatPane } from '@jini-ai/chat/react'` keeps working
 * unchanged. New code should import from this subpath directly.
 */
export {
  AgentRuntimePicker,
  CHAT_PANE_AGENT_TOOLS,
  ChatPane,
  createDaemonAttachmentUploader,
  createMcpUiToolCaller,
  defaultChatPaneSelection,
  orderChatPaneAgents,
  resolveChatPaneSelection,
  useChatPane,
  useChatPaneAgentControl,
  useChatPaneRuntimeInventory,
  useChatPaneWorkingDirectory,
} from './features/chat-pane/index.js';
export type {
  AgentRuntimePickerProps,
  ByokRuntimeSummary,
  ChatPaneActivity,
  ChatPaneAgent,
  ChatPaneAgentBridgeAccess,
  ChatPaneAgentControlOptions,
  ChatPaneAgentOption,
  ChatPaneAgentSelection,
  ChatPaneAgentToolAction,
  ChatPaneAgentToolDef,
  ChatPaneAgentToolInputSchema,
  ChatPaneAgentToolRisk,
  ChatPaneAttachmentUploadOptions,
  ChatPaneProps,
  ChatPaneRunContext,
  ChatPaneRunContextInput,
  ChatPaneRuntimeAccess,
  ChatPaneVariant,
  ChatPaneWorkingDirectoryAccess,
  CreateDaemonAttachmentUploaderOptions,
  CreateMcpUiToolCallerOptions,
  McpUiToolCallRequest,
  RuntimePickerPlacement,
  UseChatPaneAgentControlOptions,
  UseChatPaneOptions,
  UseChatPaneResult,
  UseChatPaneRuntimeInventoryOptions,
  UseChatPaneRuntimeInventoryResult,
  UseChatPaneWorkingDirectoryOptions,
  UseChatPaneWorkingDirectoryResult,
} from './features/chat-pane/index.js';
