/** @module @jini-ai/protocol/a2ui
 * A2UI v1.0 wire types, parse functions and a minimal reference interpreter. Each module documents its
 * supported contract and gaps; these exports do not imply full v1.0 interpreter parity. The zod `*Schema`
 * values stay internal to protocol (sibling files import them); use `parseDynamicValue` and the parse
 * functions at the boundary. */
export {
  isAgentEventAction,
  isLocalFunctionAction,
  parseDynamicValue,
  type AccessibilityAttributes,
  type Action,
  type AgentActionEvent,
  type AgentEventAction,
  type ArgValue,
  type CallId,
  type CheckRule,
  type Checkable,
  type Child,
  type ChildList,
  type ChildListTemplate,
  type ComponentCommon,
  type ComponentId,
  type DataBinding,
  type DynamicBoolean,
  type DynamicNumber,
  type DynamicString,
  type DynamicStringList,
  type DynamicValue,
  type FunctionCall,
  type IndexSystemFunction,
  type LocalFunctionAction,
} from './common-types.js';
export {
  AGENT_TO_RENDERER_MESSAGE_KEYS,
  parseAgentToRendererMessage,
  type ActionResponseMessage,
  type AgentToRendererMessage,
  type CallFunctionMessage,
  type ComponentsList,
  type CreateSurfaceMessage,
  type DeleteSurfaceMessage,
  type ParseFailure,
  type ParseSuccess,
  type UpdateComponentsMessage,
  type UpdateDataModelMessage,
  type WireComponent,
} from './agent-to-renderer.js';
export {
  buildActionMessage,
  buildFunctionResponseMessage,
  buildGenericErrorMessage,
  buildValidationFailedMessage,
  parseRendererToAgentMessage,
  type ActionMessage,
  type ActionMessagePayload,
  type ErrorMessage,
  type ErrorPayload,
  type FunctionResponseMessage,
  type FunctionResponsePayload,
  type GenericError,
  type RendererParseFailure,
  type RendererParseSuccess,
  type RendererToAgentMessage,
  type ValidationFailedError,
} from './renderer-to-agent.js';
export {
  callableFromOf,
  createLabCatalog,
  isComponentAllowed,
  isFunctionRegistered,
  type CallableFrom,
  type Catalog,
  type ComponentKind,
  type ComponentSpec,
  type FunctionSpec,
} from './catalog.js';
export {
  getAtPointer,
  joinPointer,
  parsePointerTokens,
  setAtPointer,
  type PointerGetResult,
} from './json-pointer.js';
export {
  resolveDynamicValue,
  type ItemScope,
  type ResolveContext,
  type ResolveFailure,
  type ResolveFailureReason,
  type ResolveOk,
  type ResolveResult,
  type ResolveSide,
} from './resolve.js';
export {
  MAX_RENDER_NODES,
  flattenRenderTree,
  type ComponentLike,
  type RenderNode,
  type RenderNodeStatus,
} from './tree.js';
export {
  buildParseFailureResult,
  createA2uiInterpreter,
  runLocalFunctionAction,
  type A2uiIdsPort,
  type A2uiInterpreter,
  type ApplyMessageResult,
  type BuildActionResult,
  type ComponentInstance,
  type SurfaceSnapshot,
} from './interpreter.js';
export {
  A2UI_DISPLAY_ONLY_PROPERTY,
  a2uiSurfaceIdOf,
  displayOnlySurfaceIdOf,
} from './surface-properties.js';
