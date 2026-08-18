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

export type { PageDriver, FindElementsFilter, PageSummary } from './page-driver.js';

export {
  executePageCapability,
  projectElementState,
  DEFAULT_HIGHLIGHT_MS,
  MAX_HIGHLIGHT_MS,
  MAX_STATEFUL_ELEMENTS,
  type FindElementsResult,
  type PageElementResult,
  type PageActivitySnapshot,
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
  isValidWebMcpToolName,
  WebMcpConfirmationRequiredError,
  InvalidWebMcpToolNameError,
  type WebMcpToolRegistration,
  type WebMcpToolAnnotations,
  type WebMcpRegisterToolOptions,
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
 * The exported symbols were renamed `Agui`/`AGUI` → `GenUi` on 2026-07-29, finishing what the
 * directory move started: with genuine AG-UI (`./ag-ui.ts`, exported just above as `toAgUiTool`
 * and friends) living in the same barrel, two unrelated protocols were reading as one.
 *
 * `@jini-ai/http-kit` used to mount this encoder behind a route still named `/api/runs/:runId/
 * agui-stream` — left un-renamed at the time on the assumption it was a wire contract an
 * already-deployed client might be calling. A 2026-08-18 audit found zero callers of that route
 * anywhere (no client in this repo or `Tovu` ever requested it, and `@jini-ai/http-kit` has never
 * actually been published to npm, so no external integrator could depend on it either); the route,
 * its registrar, and its tests were removed outright rather than renamed. This `gen-ui/` module
 * itself was untouched — it is `@jini-ai/agentic`'s own public export and its removal is a separate
 * decision.
 */
export {
  createGenUiEncoder,
  type GenUiEncodeContext,
  type GenUiEncoder,
  type GenUiAgentMessageEvent,
  type GenUiEvent,
  type GenUiEventBase,
  type GenUiEventKind,
  type GenUiRunLifecycleEvent,
  type GenUiStateUpdateEvent,
  type GenUiSurfaceRequestedEvent,
  type GenUiSurfaceRespondedEvent,
  type GenUiToolCallEvent,
} from './gen-ui/index.js';

export {
  MCP_UI_VIEW_METHODS,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_VIEW_NOTIFICATIONS,
  MCP_UI_HOST_REQUESTS,
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
