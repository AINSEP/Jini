/**
 * @jini-ai/agentic — the framework-free half of agent control.
 *
 * Everything an outside caller needs to drive a Jini frontend, with no React, no DOM, and no
 * transport: the capability vocabulary, the two shipped manifests, the `data-agent-*` markup
 * convention, and the refusals that must hold everywhere.
 *
 * Framework bindings (`@jini-ai/chat-react`, via `@jini-ai/agentic/dom`'s `createDomPageDriver`, and
 * any Vue/Svelte sibling) import from here and add only the wiring their framework needs.
 * Server-side hosts (an HTTP route table, an MCP stdio server) import the same manifests, so the
 * two can never drift apart.
 *
 * What is deliberately NOT here: how an action reaches a page. That is a transport concern —
 * same-document in a real site like a CMS, `postMessage` when a host embeds an untrusted
 * preview in a sandboxed frame. The verbs are identical either way. Also not here: any product's
 * OWN capabilities (`@jini-ai/chat-core`'s `chat.*` verbs stay in chat-core, which depends on this
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
export {
  toWebMcpTool,
  toWebMcpTools,
  WebMcpConfirmationRequiredError,
  type WebMcpToolRegistration,
  type WebMcpUserInteraction,
  type RequestUserInteraction,
  type ToWebMcpToolOptions,
} from './webmcp.js';

/**
 * Genuine AG-UI: the {@link CapabilityDef} → AG-UI *frontend tool* projection. Real conformance —
 * it emits the protocol's own `parameters` field name (not `inputSchema`) and its canonical
 * `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END` event names, all three of which appear in
 * AG-UI's published `EventType` enum.
 */
export {
  toAgUiTool,
  toAgUiTools,
  createAgUiToolResult,
  AG_UI_TOOL_CALL_EVENTS,
  type AgUiTool,
  type AgUiToolResultMessage,
} from './ag-ui.js';

/**
 * Jini's **own** run-stream surface protocol, from `./gen-ui/` — six event kinds and the encoder
 * that produces them (folded in 2026-07-26 from the standalone `@jini-ai/agui` package, plan §3a).
 *
 * Renamed from `./agui/` on 2026-07-27, because this is NOT AG-UI. The real Agent-User Interaction
 * Protocol (https://github.com/ag-ui-protocol/ag-ui) carries a 33-member `SCREAMING_SNAKE` event
 * enum — `RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, `STATE_DELTA`, `STEP_STARTED`, `REASONING_*` — and
 * shares **zero** event names with the six dotted-lowercase kinds in `./gen-ui/events.ts`, which
 * are a de-branded port of one product's internal run-event adapter. Carrying the AG-UI name on
 * them asserted a conformance that does not exist.
 *
 * `./ag-ui.ts` above was wrongly folded in with them on 2026-07-26 and moved back out on the 27th:
 * it is the one file here that really does speak AG-UI, so merging it with these six was the exact
 * inversion of the truth.
 *
 * The exported symbols below still carry `Agui`/`AGUI` prefixes: renaming those crosses into
 * `@jini-ai/http` (whose `RUN_STREAM_ROUTE_PATH` is `/api/runs/:runId/agui-stream`) and
 * `@jini-ai/protocol`, so it is deliberately not bundled with this directory move.
 */
export {
  createAguiEncoder,
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
} from './gen-ui/index.js';

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
} from './mcp-ui-apps.js';
