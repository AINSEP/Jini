import type { Clock } from "@jini-ai/core/primitives";
/**
 * @module interpreter
 *
 * The minimal A2UI client-side interpreter: client state (a component map + a JSON-Pointer-
 * addressed data model, per surface) that processes agent→renderer messages
 * (`createSurface -> updateComponents -> updateDataModel -> ...`) and produces renderer→agent
 * messages (`action`/`functionResponse`/`error`) in return. This is the piece GenUI/AG-UI
 * (`packages/agentic/src/gen-ui/`, this repo's existing, much smaller GenUI surface-request shim)
 * has no equivalent of — AG-UI streams
 * opaque `ui.surface_requested`/`ui.surface_responded` events with no component tree, no catalog,
 * no data binding; A2UI's interpreter has to actually hold and mutate structured state.
 *
 * **Design decisions made where the spec text (fetched from
 * https://github.com/a2ui-project/a2ui, `main` branch, this session) is silent, documented here
 * rather than left implicit:**
 *
 * 1. **Per-component, not per-message, validation granularity.** `updateComponents`'s own spec
 *    text says forward-referenced children/bindings should be handled gracefully — the spirit of
 *    that is "don't be brittle about partial/out-of-order information." This interpreter extends
 *    that spirit to catalog violations: one bad component in a 5-component `updateComponents`
 *    message produces one `VALIDATION_FAILED` error for that component and is skipped, while the
 *    other 4 valid components are still applied. The alternative (reject the whole message
 *    atomically) was considered and rejected as more brittle than the spec's own examples call for,
 *    not as spec-mandated either way.
 * 2. **`callFunction`/`actionResponse` are not surface-scoped on the wire** (verified directly
 *    against the fetched JSON Schemas — neither message type has a `surfaceId` field). Functions
 *    are catalog-global (one active catalog per interpreter instance); `actionResponse` is
 *    correlated by `actionId` searched across every open surface's own pending-action table.
 * 3. **`callFunction`'s `args` may contain `DataBinding` paths** (`FunctionCall.args` is typed
 *    against `DynamicValue` in `common_types.json`, which includes `DataBinding`) **but
 *    `callFunction` has no data model to bind against** (see point 2) — a real spec ambiguity, not
 *    an oversight in this port. Resolved pragmatically: such args resolve against an empty/absent
 *    data model, so any `DataBinding`-typed arg simply fails to resolve (`PATH_NOT_FOUND`,
 *    degrading sanely per `resolve.ts`'s contract) rather than crashing or guessing which surface's
 *    data model was "meant."
 * 4. **An envelope malformed enough to have no attributable `surfaceId`/`functionCallId` at all**
 *    (missing `version`, no/ambiguous message-type key) cannot be turned into a spec-shaped
 *    `error` message — `renderer_to_agent.json`'s own generic-error schema *requires* one of those
 *    two identifiers. Rather than fabricate one, `applyAgentMessage` surfaces this case out-of-band
 *    via `unattributedViolation` (a string, not sent over the wire) instead of forcing a fake
 *    identifier into a wire-conformant shape.
 */
import { AGENT_TO_RENDERER_MESSAGE_KEYS, parseAgentToRendererMessage } from './agent-to-renderer.js';
import type { AgentToRendererMessage, ComponentsList, ParseFailure } from './agent-to-renderer.js';
import { WireComponentSchema } from './agent-to-renderer.js';
import {
  buildActionMessage,
  buildFunctionResponseMessage,
  buildGenericErrorMessage,
  buildValidationFailedMessage,
} from './renderer-to-agent.js';
import type { ActionMessagePayload, RendererToAgentMessage } from './renderer-to-agent.js';
import { setAtPointer } from './json-pointer.js';
import { isComponentAllowed, type Catalog } from './catalog.js';
import { resolveDynamicValue } from './resolve.js';
import {
  type Action,
  type AgentActionEvent,
  type DynamicValue,
  type LocalFunctionAction,
} from './common-types.js';

export interface ComponentInstance {
  readonly id: string;
  readonly component: string;
  /** Validated + defaulted per the catalog's own per-type schema. Does not include `id`/`component`. */
  readonly props: Record<string, unknown>;
}

interface PendingAction {
  readonly name: string;
  readonly sourceComponentId: string;
  readonly responsePath: string | undefined;
}

interface SurfaceState {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly components: Map<string, ComponentInstance>;
  dataModel: unknown;
  readonly sendDataModel: boolean;
  readonly pendingActions: Map<string, PendingAction>;
}

export interface SurfaceSnapshot {
  readonly surfaceId: string;
  readonly catalogId: string;
  readonly components: ReadonlyMap<string, ComponentInstance>;
  readonly dataModel: unknown;
}

export interface ApplyMessageResult {
  readonly rendererMessages: readonly RendererToAgentMessage[];
  /** See module doc, decision 4. Not part of the wire protocol — a local-only diagnostic. */
  readonly unattributedViolation?: string;
}

export type BuildActionResult =
  | { readonly ok: true; readonly kind: 'agent'; readonly message: RendererToAgentMessage }
  | { readonly ok: true; readonly kind: 'local'; readonly result: unknown }
  | { readonly ok: false; readonly reason: string };

/** Host ports keep action IDs and timestamps deterministic and product-independent. */
export interface A2uiIdsPort { next(required: Record<string, never>): string }

/**
 * Best-effort `surfaceId` extraction from a raw envelope's message-type-keyed body, without
 * assuming the envelope is well-formed. Used only to attribute a parse failure to a surface when
 * possible (see `buildParseFailureResult`); never trusted for anything else.
 */
function bestEffortSurfaceId(raw: unknown, key: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const body = (raw as Record<string, unknown>)[key];
  if (typeof body !== 'object' || body === null) return undefined;
  const surfaceId = (body as Record<string, unknown>).surfaceId;
  return typeof surfaceId === 'string' ? surfaceId : undefined;
}

/**
 * Turns a `ParseFailure` (from `parseAgentToRendererMessage`) into what `applyAgentMessage`
 * returns for it. See this module's doc, decision 4: an envelope malformed enough to carry no
 * attributable `surfaceId`/`functionCallId` cannot be turned into a spec-shaped `error` message —
 * `renderer_to_agent.json`'s own generic-error schema *requires* one of those two identifiers —
 * so it surfaces out-of-band via `unattributedViolation` (a string, not sent over the wire)
 * instead of forcing a fake identifier into a wire-conformant shape.
 *
 * Exported and pure — it only reads `parsed`/`raw`, so the surfaceId-attribution rule can be
 * tested directly, without a live interpreter instance.
 */
export function buildParseFailureResult({ parsed, raw }: { parsed: ParseFailure; raw: unknown }, _optional: Record<string, never> = {}): ApplyMessageResult {
  if (
    parsed.code === 'MISSING_VERSION'
    || parsed.code === 'UNSUPPORTED_VERSION'
    || parsed.code === 'NO_MESSAGE_KEY'
    || parsed.code === 'AMBIGUOUS_MESSAGE'
  ) {
    return { rendererMessages: [], unattributedViolation: parsed.message };
  }
  // VALIDATION_FAILED from the dispatcher: either `raw` wasn't even an object (`bestEffortSurfaceId`
  // safely returns `undefined` for that, same as every other shape it doesn't recognize — no
  // separate guard needed here), or exactly one of the six known message-type keys was present
  // and its body failed schema validation. Checked against the *known* keys specifically
  // (`AGENT_TO_RENDERER_MESSAGE_KEYS`), not "whatever the first non-version object key happens to
  // be" — an envelope could carry unrelated extra top-level junk ahead of the real message key in
  // insertion order, and grabbing that first would attribute the error to the wrong place. Best-
  // effort surfaceId extraction so this can still be a spec-shaped error where possible
  // (createSurface/updateComponents/updateDataModel/deleteSurface all carry surfaceId at the top
  // of their body even when some other field is what actually failed validation); callFunction/
  // actionResponse have no surfaceId at all, so those fall back to the out-of-band channel too.
  const surfaceId = AGENT_TO_RENDERER_MESSAGE_KEYS.map((key) => bestEffortSurfaceId(raw, key)).find(
    (id): id is string => id !== undefined,
  );
  if (surfaceId) {
    // `parsed.path` is guaranteed set here: `ParseFailure.path` is only ever omitted for the
    // "raw input wasn't even an object" case (`agent-to-renderer.ts`'s very first guard), and
    // `surfaceId` above could only have resolved to a truthy value if `raw` *was* an object
    // (`bestEffortSurfaceId` requires that) — so this specific combination (object-shaped raw,
    // yet no `path`) cannot occur. Asserted, not defensively branched, per this package's
    // testing discipline (see the zod-issues-array comments elsewhere in this file).
    return { rendererMessages: [buildValidationFailedMessage({ surfaceId, path: parsed.path!, message: parsed.message })] };
  }
  return { rendererMessages: [], unattributedViolation: parsed.message };
}

/**
 * Runs a component's local `functionCall` action synchronously against `dataModel` — no network
 * round trip, no pending-action bookkeeping (that only applies to the agent-event branch; see
 * `interpreter`'s `buildAction`/`buildAgentEventAction`).
 *
 * Exported and pure given its inputs, so "a local action resolves against the surface's actual
 * data model, and a resolution failure becomes a typed refusal rather than a thrown error" can be
 * tested without a live interpreter instance.
 */
export function runLocalFunctionAction({ dataModel, catalog, action }: { dataModel: unknown; catalog: Catalog; action: LocalFunctionAction }, _optional: Record<string, never> = {}
): BuildActionResult {
  const result = resolveDynamicValue({ value: action.functionCall, ctx: { dataModel, catalog, side: 'renderer' } });
  return result.ok ? { ok: true, kind: 'local', result: result.value } : { ok: false, reason: result.detail };
}

export interface A2uiInterpreter {
  applyAgentMessage(required: { raw: unknown }, _optional?: Record<string, never>): ApplyMessageResult;
  getSurface(required: { surfaceId: string }, _optional?: Record<string, never>): SurfaceSnapshot | undefined;
  listSurfaceIds(_required: Record<string, never>, _optional?: Record<string, never>): string[];
  /** `undefined` if the surface doesn't exist, or exists but has no component with id `'root'` yet (a legal, "still streaming in" state per the spec's own forward-reference tolerance). */
  getRoot(required: { surfaceId: string }, _optional?: Record<string, never>): ComponentInstance | undefined;
  /** Resolves a component's `action` prop (if any) for dispatch — builds the `action` envelope for an agent-event action, or synchronously runs a local `functionCall` action. Called by a host renderer on a real user interaction (e.g. a Button click). */
  buildAction(required: { surfaceId: string; componentId: string }, optional?: { now?: ((required: Record<string, never>) => number) | undefined }): BuildActionResult;
  resolve(required: { surfaceId: string; value: DynamicValue }, optional?: { itemBasePath?: string | undefined; itemIndex?: number | undefined }): ReturnType<typeof resolveDynamicValue>;
  subscribe(required: { listener: (required: Record<string, never>) => void }, _optional?: Record<string, never>): (required: Record<string, never>) => void;
}

export function createA2uiInterpreter({ catalog, clock, ids }: { catalog: Catalog; clock: Clock; ids: A2uiIdsPort }, _optional: Record<string, never> = {}): A2uiInterpreter {
  const surfaces = new Map<string, SurfaceState>();
  const listeners = new Set<(required: Record<string, never>) => void>();

  function notify(): void {
    for (const listener of listeners) listener({});
  }

  function applyComponentsList(surface: SurfaceState, wireComponents: ComponentsList): RendererToAgentMessage[] {
    const errors: RendererToAgentMessage[] = [];
    wireComponents.forEach((wireComponent, index) => {
      const { id, component: type, ...rest } = wireComponent;
      if (!isComponentAllowed({ catalog, componentType: type })) {
        errors.push(
          buildValidationFailedMessage({ surfaceId: surface.surfaceId, path: `/components/${index}/component`, message: `Component type "${type}" is not in catalog "${catalog.catalogId}" — refused, not rendered.` }
          ),
        );
        return;
      }
      const spec = catalog.components.get(type)!;
      const parsed = spec.propsSchema.safeParse(rest);
      if (!parsed.success) {
        // zod guarantees a non-empty `issues` array on failure — see agent-to-renderer.ts's
        // parseAgentToRendererMessage for the same asserted (not defensively branched) invariant.
        const issue = parsed.error.issues[0]!;
        // `issue.message` alone ("Required") names no field — Zod puts the field on `issue.path`
        // instead, so it has to be spliced back in here or the only place a human sees this (this
        // string, not the sibling `path` pointer on the built message) never says which prop.
        const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        errors.push(
          buildValidationFailedMessage({ surfaceId: surface.surfaceId, path: `/components/${index}/${issue.path.join('/')}`, message: `Component "${id}" (${type}) failed catalog validation: ${field}: ${issue.message}` }
          ),
        );
        return;
      }
      surface.components.set(id, { id, component: type, props: parsed.data as Record<string, unknown> });
    });
    return errors;
  }

  function handleCreateSurface(message: Extract<AgentToRendererMessage, { createSurface: unknown }>): RendererToAgentMessage[] {
    const { surfaceId, catalogId, components, dataModel } = message.createSurface;
    if (catalogId !== catalog.catalogId) {
      return [buildValidationFailedMessage({ surfaceId, path: '/createSurface/catalogId', message: `Unknown catalogId "${catalogId}" — this renderer only has "${catalog.catalogId}" loaded.` })];
    }
    if (surfaces.has(surfaceId)) {
      return [buildValidationFailedMessage({ surfaceId, path: '/createSurface/surfaceId', message: `Surface "${surfaceId}" already exists — delete it before recreating (per spec).` })];
    }
    const surface: SurfaceState = {
      surfaceId,
      catalogId,
      components: new Map(),
      dataModel: dataModel ?? {},
      sendDataModel: message.createSurface.sendDataModel ?? false,
      pendingActions: new Map(),
    };
    surfaces.set(surfaceId, surface);
    return components ? applyComponentsList(surface, components) : [];
  }

  function handleUpdateComponents(message: Extract<AgentToRendererMessage, { updateComponents: unknown }>): RendererToAgentMessage[] {
    const { surfaceId, components } = message.updateComponents;
    const surface = surfaces.get(surfaceId);
    if (!surface) {
      return [buildValidationFailedMessage({ surfaceId, path: '/updateComponents/surfaceId', message: `Unknown surfaceId "${surfaceId}" — createSurface must be sent first.` })];
    }
    return applyComponentsList(surface, components);
  }

  function handleUpdateDataModel(message: Extract<AgentToRendererMessage, { updateDataModel: unknown }>): RendererToAgentMessage[] {
    const { surfaceId, path, value } = message.updateDataModel;
    const surface = surfaces.get(surfaceId);
    if (!surface) {
      return [buildValidationFailedMessage({ surfaceId, path: '/updateDataModel/surfaceId', message: `Unknown surfaceId "${surfaceId}" — createSurface must be sent first.` })];
    }
    surface.dataModel = setAtPointer({ doc: surface.dataModel, pointer: path ?? '/', value });
    return [];
  }

  function handleDeleteSurface(message: Extract<AgentToRendererMessage, { deleteSurface: unknown }>): RendererToAgentMessage[] {
    const { surfaceId } = message.deleteSurface;
    if (!surfaces.has(surfaceId)) {
      return [buildValidationFailedMessage({ surfaceId, path: '/deleteSurface/surfaceId', message: `Unknown surfaceId "${surfaceId}" — nothing to delete.` })];
    }
    // Dropping the whole SurfaceState also drops its pendingActions map — any actionResponse that
    // arrives afterward for an actionId that lived here simply won't be found (handled gracefully
    // in handleActionResponse below), which is exactly the "deleteSurface mid-flight" adversarial
    // case this is designed to answer.
    surfaces.delete(surfaceId);
    return [];
  }

  function handleCallFunction(message: Extract<AgentToRendererMessage, { callFunction: unknown }>): RendererToAgentMessage[] {
    const { functionCallId, callFunction, wantResponse } = message;
    const result = resolveDynamicValue({ value: callFunction, ctx: { dataModel: undefined, catalog, side: 'agent' } });
    if (!result.ok) {
      const code = result.reason === 'FUNCTION_NOT_CALLABLE_FROM_SIDE' || result.reason === 'FUNCTION_NOT_REGISTERED' ? 'INVALID_FUNCTION_CALL' : result.reason;
      return [buildGenericErrorMessage({ code, message: result.detail, target: { functionCallId } })];
    }
    if (!wantResponse) return [];
    // `?? null` because `functionResponse.value` is required on the wire and JSON has no
    // `undefined`: a `returnType: 'void'` function (the catalog has three) resolves to
    // `undefined`, and passing that straight through built a message whose `value` vanished on
    // serialization — one this package's own `parseRendererToAgentMessage` correctly refuses.
    return [buildFunctionResponseMessage({ payload: { functionCallId, call: callFunction.call, value: result.value ?? null } })];
  }

  function handleActionResponse(message: Extract<AgentToRendererMessage, { actionResponse: unknown }>): RendererToAgentMessage[] {
    const { actionId, actionResponse } = message;
    for (const surface of surfaces.values()) {
      const pending = surface.pendingActions.get(actionId);
      if (!pending) continue;
      surface.pendingActions.delete(actionId);
      if ('value' in actionResponse && pending.responsePath) {
        surface.dataModel = setAtPointer({ doc: surface.dataModel, pointer: pending.responsePath, value: actionResponse.value });
      }
      return [];
    }
    // No surface has a pending action under this id — already resolved, never existed, or its
    // surface was deleted while the action was in flight. Graceful no-op, not an error: the agent
    // sent a well-formed message, it just arrived too late (or was mistaken) to mean anything now.
    return [];
  }

  /** Routes one successfully-parsed envelope to its message-type handler. */
  function dispatchAgentMessage(message: AgentToRendererMessage): RendererToAgentMessage[] {
    if ('createSurface' in message) return handleCreateSurface(message);
    if ('updateComponents' in message) return handleUpdateComponents(message);
    if ('updateDataModel' in message) return handleUpdateDataModel(message);
    if ('deleteSurface' in message) return handleDeleteSurface(message);
    if ('callFunction' in message) return handleCallFunction(message);
    return handleActionResponse(message);
  }

  function applyAgentMessage({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): ApplyMessageResult {
    const parsed = parseAgentToRendererMessage({ raw });
    if (!parsed.ok) return buildParseFailureResult({ parsed, raw });

    const rendererMessages = dispatchAgentMessage(parsed.message);
    notify();
    return { rendererMessages };
  }

  function getSurface({ surfaceId }: { surfaceId: string }, _optional: Record<string, never> = {}): SurfaceSnapshot | undefined {
    const surface = surfaces.get(surfaceId);
    if (!surface) return undefined;
    return { surfaceId: surface.surfaceId, catalogId: surface.catalogId, components: surface.components, dataModel: surface.dataModel };
  }

  function getRoot({ surfaceId }: { surfaceId: string }, _optional: Record<string, never> = {}): ComponentInstance | undefined {
    return surfaces.get(surfaceId)?.components.get('root');
  }

  function resolve({ surfaceId, value }: { surfaceId: string; value: DynamicValue }, { itemBasePath, itemIndex }: { itemBasePath?: string | undefined; itemIndex?: number | undefined } = {}) {
    const surface = surfaces.get(surfaceId);
    const itemScope = itemBasePath !== undefined && itemIndex !== undefined ? { basePath: itemBasePath, index: itemIndex } : undefined;
    return resolveDynamicValue({ value, ctx: { dataModel: surface?.dataModel, catalog, side: 'renderer' } }, { itemScope });
  }

  function resolveActionContext(context: Record<string, DynamicValue> | undefined, surfaceId: string): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context ?? {})) {
      const result = resolve({ surfaceId, value });
      resolved[key] = result.ok ? result.value : null;
    }
    return resolved;
  }

  /** Looks up the surface, component, and `action` prop `buildAction` needs, or the specific reason it can't. */
  function resolveActionTarget(
    surfaceId: string,
    componentId: string,
  ): { ok: true; surface: SurfaceState; action: Action } | { ok: false; reason: string } {
    const surface = surfaces.get(surfaceId);
    if (!surface) return { ok: false, reason: `unknown surfaceId "${surfaceId}"` };
    const component = surface.components.get(componentId);
    if (!component) return { ok: false, reason: `unknown componentId "${componentId}" on surface "${surfaceId}"` };
    const action = component.props.action as Action | undefined;
    if (!action) return { ok: false, reason: `component "${componentId}" has no action` };
    return { ok: true, surface, action };
  }

  /** Builds the `action` wire envelope for an agent-event action, registering a pending response if `wantResponse` was set. */
  function buildAgentEventAction(
    surface: SurfaceState,
    surfaceId: string,
    componentId: string,
    event: AgentActionEvent,
    now: (required: Record<string, never>) => number,
  ): BuildActionResult {
    const { name, context, wantResponse, responsePath } = event;
    const actionId = wantResponse ? ids.next({}) : undefined;
    if (actionId) {
      surface.pendingActions.set(actionId, { name, sourceComponentId: componentId, responsePath });
    }
    const payload: ActionMessagePayload = {
      name,
      surfaceId,
      sourceComponentId: componentId,
      timestamp: new Date(now({})).toISOString(),
      context: resolveActionContext(context, surfaceId),
      ...(wantResponse !== undefined ? { wantResponse } : {}),
      ...(actionId !== undefined ? { actionId } : {}),
    };
    return { ok: true, kind: 'agent', message: buildActionMessage({ payload }) };
  }

  function buildAction({ surfaceId, componentId }: { surfaceId: string; componentId: string }, { now }: { now?: ((required: Record<string, never>) => number) | undefined } = {}): BuildActionResult {
    const target = resolveActionTarget(surfaceId, componentId);
    if (!target.ok) return target;
    const { surface, action } = target;

    if ('functionCall' in action) {
      return runLocalFunctionAction({ dataModel: surface.dataModel, catalog, action });
    }
    // `ActionSchema` (validated when this component's props were ingested — see
    // `applyComponentsList`) is a closed 2-branch union: `{event}` | `{functionCall}`. Having
    // already eliminated the `functionCall` branch above, TypeScript itself narrows `action` to
    // the `event` branch here — no runtime `isAgentEventAction` re-check is reachable to fail; a
    // malformed third shape could never have made it into `component.props.action` in the first
    // place. (Not defensively branched-and-left-untested, per this package's own testing
    // discipline — see the zod-issues-array comments above for the same principle.)
    return buildAgentEventAction(surface, surfaceId, componentId, action.event, now ?? (() => clock.nowMs()));
  }

  return {
    applyAgentMessage,
    getSurface,
    listSurfaceIds: (_required: Record<string, never>) => [...surfaces.keys()],
    getRoot,
    buildAction,
    resolve,
    subscribe: ({ listener }: { listener: (required: Record<string, never>) => void }) => {
      listeners.add(listener);
      return (_required: Record<string, never>) => { listeners.delete(listener); };
    },
  };
}

export { WireComponentSchema };
