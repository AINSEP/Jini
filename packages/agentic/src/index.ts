/**
 * @jini/agentic — the framework-free half of agent control.
 *
 * Everything an outside caller needs to drive a Jini frontend, with no React, no DOM, and no
 * transport: the capability vocabulary, the two shipped manifests, the `data-agent-*` markup
 * convention, and the refusals that must hold everywhere.
 *
 * Framework bindings (`@jini/chat-react`, via `@jini/agentic/dom`'s `createDomPageDriver`, and
 * any Vue/Svelte sibling) import from here and add only the wiring their framework needs.
 * Server-side hosts (an HTTP route table, an MCP stdio server) import the same manifests, so the
 * two can never drift apart.
 *
 * What is deliberately NOT here: how an action reaches a page. That is a transport concern —
 * same-document in a real site like a CMS, `postMessage` when a host embeds an untrusted
 * preview in a sandboxed frame. The verbs are identical either way. Also not here: any product's
 * OWN capabilities (`@jini/chat-core`'s `chat.*` verbs stay in chat-core, which depends on this
 * package for the vocabulary rather than the other way around) — see this package's
 * source-map.md for why the split is real rather than a wholesale relocation.
 */
export {
  findCapability,
  findCapabilityInputError,
  availableCapabilities,
  type CapabilityDef,
  type CapabilityInputSchema,
  type CapabilityRisk,
  type CapabilitySurface,
} from './capability.js';

export type { PageDriver, FindElementsFilter } from './page-driver.js';

export {
  executePageCapability,
  projectElementState,
  DEFAULT_HIGHLIGHT_MS,
  MAX_HIGHLIGHT_MS,
  MAX_STATEFUL_ELEMENTS,
  type FindElementsResult,
  type PageElementResult,
  type PageSummary,
  type PageWriteObservation,
} from './page-executor.js';

export { PAGE_CAPABILITIES } from './page-capabilities.js';

export {
  AGENT_ELEMENT_ATTRIBUTE,
  AGENT_ROLE_ATTRIBUTE,
  AGENT_LABEL_ATTRIBUTE,
  AGENT_PAGE_ATTRIBUTE,
  AGENT_ELEMENT_ROLES,
  isValidElementHandle,
  resolveHandleSelector,
  type AgentElementRole,
  type AgentElementDescriptor,
  type AgentElementRawState,
  type AgentElementState,
} from './element-handles.js';

export { agentHandle, type AgentHandleOptions, type AgentHandleProps } from './handle.js';

export {
  findFieldFillRefusal,
  findFieldReadRefusal,
  describeFieldRefusal,
  describeFieldReadRefusal,
  normalizeAgentLabel,
  MAX_AGENT_LABEL_LENGTH,
  type FieldDescriptor,
  type FieldRefusal,
  type FieldReadRefusal,
  type NormalizedLabel,
} from './guards.js';

/**
 * Protocol adapters, named for what they derive from.
 *
 * Each is a ONE-WAY projection out of the neutral core: they import `capability.js`, and nothing
 * imports back. That direction is the whole point — if the core ever imported an adapter, the
 * protocol we happened to build against would leak into the vocabulary and the layer would stop
 * being neutral. None of them opens a connection or touches a browser global; a framework
 * binding owns transport and host access.
 */
export { toWebMcpTool, toWebMcpTools, type WebMcpToolRegistration } from './webmcp.js';

/**
 * Both halves of AG-UI, from `./agui/` — the capability→frontend-tool projection and the
 * run-stream→wire-event encoder (the latter folded in 2026-07-26 from the standalone
 * `@jini/agui` package, plan §3a). They live in one directory because they are one protocol; see
 * that directory's module doc for why they were briefly, and confusingly, apart.
 */
export {
  toAgUiTool,
  toAgUiTools,
  createAgUiToolResult,
  AG_UI_TOOL_CALL_EVENTS,
  createAguiEncoder,
  type AgUiTool,
  type AgUiToolResultMessage,
  type AguiEncodeContext,
  type AguiEncoder,
  type AGUIAgentMessageEvent,
  type AGUIEvent,
  type AGUIEventBase,
  type AGUIEventKind,
  type AGUIRunLifecycleEvent,
  type AGUIStateUpdateEvent,
  type AGUISurfaceRequestedEvent,
  type AGUISurfaceRespondedEvent,
  type AGUIToolCallEvent,
} from './agui/index.js';

export {
  MCP_UI_VIEW_METHODS,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_SANDBOX_NOTE,
  JINI_PAGE_ACTION_METHOD,
  JSON_RPC_ERROR_CODES,
  isJsonRpcMessage,
  isJsonRpcRequest,
  createJsonRpcRequest,
  createJsonRpcNotification,
  createJsonRpcResult,
  createJsonRpcError,
  createPageActionRequest,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type JsonRpcError,
} from './mcp-ui.js';
