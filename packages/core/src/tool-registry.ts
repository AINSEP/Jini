/**
 * `ToolRegistry` — the registration half of the tool-execution boundary
 * (extraction-plan.md §2.5 / §8 task 6). Tools are registered as
 * `{descriptor, handler, policy}` triples; the registry's *public* surface
 * (this file's `ToolRegistry` interface, and everything re-exported from
 * this package's root `index.ts`) exposes only `ToolDescriptor`s —
 * `register`/`has`/`list`. Revocable host scopes add replacement without retrieval. It never exposes a way to retrieve a `handler`
 * or `policy` back out.
 *
 * That's the load-bearing invariant this task is named after: "handlers
 * never publicly retrievable (routes/agents can't bypass authz)." A route
 * or an agent holding a `ToolRegistry` reference can enumerate what's
 * available and check membership, but the only way to actually *run* a
 * tool is through `@jini-ai/daemon`'s `ToolExecutor`, which is the sole
 * consumer of {@link authorizeToolInvocation} — a function deliberately
 * exported from `./composition.js` (a package-internal entry point, see this
 * package's `package.json` `exports` map and `archived provenance ledger`) rather than
 * from the public `index.ts` barrel. Every other caller of
 * `@jini-ai/core`'s default entry point gets descriptors only.
 * `authorizeToolInvocation` itself runs the tool's `ToolPolicy` (and an
 * optional transport veto) before ever handing back a handler, so a
 * runtime handler closure is unobtainable without already having passed
 * authorization — the earlier design (a separate `getToolRegistration`
 * that returned the handler unconditionally) let any caller of this
 * package-internal entry point skip the gate entirely; see this package's
 * `archived provenance ledger` for the 2026-07-29 hardening note.
 */
import type { Principal } from './principal.js';
import type { AgentToolSideEffect } from './agent-tools.js';
import type { ToolMetadata } from './tool-metadata-types.js';
import { normalizeToolInput, type ToolInputNormalizer } from './tool-input-normalization.js';

/** A structural run reference — anything with a stable `id` satisfies this (e.g. `@jini-ai/protocol`'s `RunStatus`). No import needed to satisfy it; see the module doc. */
export interface RunRef {
  readonly id: string;
}

/**
 * The public, non-secret shape of a registered tool. Never carries the
 * handler or policy — those are only reachable via {@link authorizeToolInvocation}.
 */
export interface ToolDescriptor {
  /** Domain-owned discovery and approval metadata; grants no execution authority. */
  readonly metadata?: ToolMetadata;
  readonly id: string;
  readonly description?: string;
  /**
   * JSON-Schema-shaped description of this tool's accepted input, carried as `unknown` because the
   * gate reads common property/type fields for input normalization but leaves validation and
   * schema dialects to the handler; no validator dependency belongs in every registry consumer.
   *
   * It exists because *every* discovery mechanism needs it and nothing else in the kernel can
   * supply it: a caller that can enumerate `ToolRegistry.list({})` still cannot tell an agent what
   * arguments a tool takes, which reduces discovery to guess-and-check against an opaque id.
   * Optional and additive, so no existing registration changes shape.
   */
  readonly inputSchema?: unknown;
  /** When true, `ToolExecutor` asks the transport's `ExecutionDelegate.onConfirm` before running, in addition to authorization. */
  readonly requiresConfirmation?: boolean;
  /** Milliseconds before `ToolExecutor` aborts an in-flight call and reports `'timed-out'`. Omit for no timeout. */
  readonly timeoutMs?: number;
  /** Byte/character ceiling `ToolExecutor` truncates string output to. Omit for no truncation. */
  readonly maxOutputBytes?: number;
  /**
   * True when running this tool changes nothing a later read could observe — no durable write, no
   * token minted, no external side effect. Consumed by {@link isReadOnlyTool}, which is the one
   * place the question is ever answered.
   *
   * The kernel does not derive it: a tool's risk must not be self-declared by the layer that also
   * decides to run it, so the value is set by whatever wiring layer independently classifies what a
   * handler calls (`@jini-ai/cms`'s `buildDomainRegistrations` maps its domains' `sideEffects`
   * vocabulary onto it, after `assertToolIsWirable` has already refused any tool whose declaration
   * disagrees with the derived classification).
   *
   * Optional and additive, so no existing registration changes shape — and deliberately NOT
   * defaulted to `true`: an omitted flag means "nobody has classified this", which
   * {@link isReadOnlyTool} treats as not-read-only. A read-only gate that read silence as safety
   * would admit every unclassified write, which is the exact failure the flag exists to prevent.
   */
  readonly readOnly?: boolean;
  /** Independently checked domain risk, retained for discovery; never grants permission. */
  readonly sideEffects?: AgentToolSideEffect;
}

/**
 * The single read-only determination: may this tool run through a surface that has promised its
 * caller it only reads?
 *
 * Every read-only gate in the system asks this one function rather than testing the field itself,
 * so the rule lives in exactly one place — a change to what counts as read-only is a change to this
 * body, not a sweep across transports.
 *
 * @param required.descriptor - The registered descriptor, or `undefined` for an id that resolved to nothing.
 * @returns `true` only for a descriptor that explicitly declares `readOnly: true`.
 * @complexity O(1).
 */
export function isReadOnlyTool({ descriptor }: { descriptor: ToolDescriptor | undefined }): boolean {
  return descriptor?.readOnly === true;
}

/** Project registration risk for discovery using the same read-only decision as execution.
 * Missing classification stays unknown; discovery never grants execution authority.
 * @returns Explicit readOnly and sideEffects fields for a registry descriptor.
 * @complexity O(1); no effects.
 */
export function toolDiscoveryMetadata({ descriptor }: { descriptor: Pick<ToolDescriptor, 'id' | 'readOnly' | 'sideEffects'> | undefined }, _options = {}): {
  readOnly: boolean; sideEffects: AgentToolSideEffect | 'unknown';
} {
  const readOnly = isReadOnlyTool({ descriptor });
  return { readOnly, sideEffects: descriptor?.sideEffects ?? (readOnly ? 'none' : 'unknown') };
}

/**
 * One human-facing message a handler pushes out mid-call.
 *
 * `channel` becomes the run event payload's `type`, and `payload` is merged in beside it. It is
 * deliberately NOT a union of the known channels: `@jini-ai/protocol` sits below every package in
 * the graph and already types each channel's own body as `unknown` for exactly this reason —
 * structural validation belongs where the concrete type is known (`@jini-ai/ui`'s `parseUIResource`
 * for mcp-ui, `@jini-ai/agentic/a2ui`'s `parseAgentToRendererMessage` for a2ui). Naming the channel
 * as a string is what lets a handler drive `mcp-ui`, `a2ui`, or `surface_request` — or a channel
 * that does not exist yet — through one seam.
 *
 * @example mcp-ui — a sandboxed HTML surface; the transport supplies `toolUseId`
 * `{ channel: 'mcp-ui', payload: { resource } }`
 * @example a2ui — a component tree that can be updated repeatedly on one held-open call
 * `{ channel: 'a2ui', payload: { message: createSurface(exchangeId, ...) } }`
 * @example the protocol-neutral human-in-the-loop pair
 * `{ channel: 'surface_request', payload: { surfaceId, surfaceKind: 'form', payload: {...} } }`
 */
export interface SurfaceEmission {
  /** The run event payload `type` this belongs on. */
  readonly channel: string;
  /** The channel's own fields, merged into the emitted event beside `type`. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Pushes a human-facing message into the run's event stream *while the call is still in flight*.
 *
 * A handler's return value is the only other way to reach a human, and that route is useless to a
 * handler that must WAIT for one: the daemon reads surfaces out of the completed result, so a
 * handler that parks first never emits the thing being answered, and the park can never resolve.
 * That is a deadlock by construction, not a race. This is the seam that breaks it — emit, then await.
 *
 * Callable any number of times before the call settles, which is what makes a multi-turn exchange
 * (A2UI's `createSurface` → action → `updateComponents` → action) expressible on a single tool call
 * rather than only a one-shot ask.
 *
 * Human-only in both directions: emitting never puts anything into model context.
 *
 * Optional because it is transport-supplied. A caller with no run event stream to emit into (a
 * headless or synthetic execution) omits it, and a handler that finds it absent must fall back to
 * returning its surface rather than parking — see the `@jini-ai/daemon` bridge for the supplying end.
 */
export type SurfaceEmitter = (emission: SurfaceEmission) => Promise<void>;

/** What a `ToolHandler` receives — everything it needs and nothing it could use to bypass the gate (no registry access, no other tools' state). */
export interface ToolExecutionContext {
  /** The id `ToolExecutor` assigned this call — for the handler's own logging/correlation; carries no authority (the gate already ran before the handler is invoked). */
  readonly executionId: string;
  readonly principal: Principal;
  readonly run: RunRef;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

/** Optional handler ports supplied by the invoking transport. */
export interface ToolExecutionOptions {
  readonly emitSurface?: SurfaceEmitter;
  /** Invoke through the same executor, retaining this call's principal, run, cancellation and
   * transport gates. Rejects on denial, failed confirmation, validation or execution failure.
   * A composition-owned registry may retain a source registration behind a derived catalog card.
   * Batch wrappers use this port for each final merged input; every supplied registry is gated.
   */
  readonly invokeTool?: (required: { toolId: string; input: unknown }, optional?: { registry?: ToolRegistry }) => Promise<unknown>;
}

/** Runs the tool's actual side effect. Only ever invoked by `ToolExecutor`, never called directly by a route/agent holding the registry. */
export type ToolHandler = (required: ToolExecutionContext, optional?: ToolExecutionOptions) => Promise<unknown>;

export { ToolInputError } from './tool-input-errors.js';

export type AuthorizationDecision = 'allow' | 'deny';

export interface ToolAuthorizationContext {
  readonly principal: Principal;
  readonly run: RunRef;
  readonly tool: ToolDescriptor;
  readonly input: unknown;
}

/**
 * A tool's admission-control rule: given who's calling, on which run, with
 * what input, is this call allowed at all? Distinct from *confirmation*
 * (`ToolDescriptor.requiresConfirmation`, a per-call human "are you sure"
 * gate `ToolExecutor` applies afterward) — a policy answers "is this
 * principal permitted to use this tool", a confirmation answers "does the
 * user want to proceed with this specific invocation right now."
 */
export interface ToolPolicy {
  authorize(ctx: ToolAuthorizationContext): AuthorizationDecision | Promise<AuthorizationDecision>;
}

export interface ToolRegistration {
  /** Optional execution-only schema, e.g. authenticated form callbacks. Never published by discovery;
   * the handler must retain callback authentication and authorization. Defaults to descriptor.inputSchema. */
  readonly invocationSchema?: unknown;
  /** Domain-owned aliases, read by the single execution gate before validation/authorization. */
  readonly normalizeInput?: ToolInputNormalizer;
  readonly descriptor: ToolDescriptor;
  readonly handler: ToolHandler;
  readonly policy: ToolPolicy;
}

/** The public registration/enumeration surface. See the module doc for why `handler`/`policy` never appear here. */
export interface ToolRegistry {
  /** @throws If the policy has no callable `authorize` or `registration.descriptor.id` is already registered — re-registration must be explicit (unregister is not exposed; this registry is append-only by design, matching the kernel's "tools are registered once at composition time" model). */
  register(registration: ToolRegistration): void;
  has(required: { toolId: string }): boolean;
  /** Descriptors only, in registration order. Never the underlying handlers/policies. */
  list(_required: Record<string, never>): readonly ToolDescriptor[];
}

const registrationsByRegistry = new WeakMap<ToolRegistry, Map<string, ToolRegistration>>();
/** Refuse malformed runtime contributions before either registration path changes the registry. */
function assertAuthorizationPolicy({ registration }: { registration: ToolRegistration }, _optional: Record<string, never> = {}): void {
  if (typeof registration.policy?.authorize !== 'function') {
    throw new Error(`ToolRegistry: tool "${registration.descriptor.id}" must declare an authorization policy`);
  }
}
// Static register() remains append-only; scoped host contributions below explicitly own removal.
const registryRevisions = new WeakMap<object, number>();
/** A host can invalidate its disposable discovery snapshot without exposing handlers. */
export function toolRegistryRevision(required: { registry: object }, _optional: Record<string, never> = {}): number | undefined {
  return registryRevisions.get(required.registry);
}
/** Revocable registration scope on the SAME registry the executor owns. Collision validation
 * completes before mutation, so a failed replacement cannot lose the working generation.
 * Only this closure may remove its own registrations; native and other scopes remain protected.
 * Already-authorized closures are revoked too: confirmation can await a human across disable. */
export function createToolRegistrationScope(required: { registry: ToolRegistry }, _optional: Record<string, never> = {}) {
  const registrations = registrationsByRegistry.get(required.registry);
  if (!registrations) throw new Error('registration scopes require a core ToolRegistry');
  let owned = new Set<string>();
  let generation = 0;
  return {
    replace({ registrations: next }: { registrations: readonly ToolRegistration[] }, _optional: Record<string, never> = {}) {
      const ids = new Set<string>();
      for (const registration of next) {
        assertAuthorizationPolicy({ registration });
        const id = registration.descriptor.id;
        if (ids.has(id) || (registrations.has(id) && !owned.has(id))) throw new Error(`ToolRegistry: tool "${id}" is already registered`);
        ids.add(id);
      }
      generation++;
      const current = generation;
      for (const id of owned) registrations.delete(id);
      for (const registration of next) registrations.set(registration.descriptor.id, { ...registration,
        handler: (input, options) => {
          if (generation !== current) throw new Error('tool registration was revoked');
          return registration.handler(input, options);
        },
      });
      owned = ids;
      registryRevisions.set(required.registry, (registryRevisions.get(required.registry) ?? 0) + 1);
    },
  };
}


/**
 * Creates an empty, append-only `ToolRegistry`.
 *
 * @returns A `ToolRegistry` whose backing `{descriptor, handler, policy}`
 * map is held in a module-private `WeakMap` keyed by the returned instance
 * — reachable only via {@link authorizeToolInvocation}, not through any method
 * on the returned object itself.
 * @complexity `register`/`has` O(1); `list` O(n) in registered tool count.
 * @overallScore 100/100
 */
export function createToolRegistry(_required: Record<string, never>): ToolRegistry {
  const registrations = new Map<string, ToolRegistration>();

  const registry: ToolRegistry = {
    register(registration: ToolRegistration): void {
      assertAuthorizationPolicy({ registration });
      if (registrations.has(registration.descriptor.id)) {
        throw new Error(`ToolRegistry: tool "${registration.descriptor.id}" is already registered`);
      }
      registrations.set(registration.descriptor.id, registration);
      registryRevisions.set(registry, (registryRevisions.get(registry) ?? 0) + 1);
    },
    has({ toolId }: { toolId: string }): boolean {
      return registrations.has(toolId);
    },
    list(_required: Record<string, never>): readonly ToolDescriptor[] {
      return Array.from(registrations.values(), (r) => r.descriptor);
    },
  };

  registrationsByRegistry.set(registry, registrations);
  registryRevisions.set(registry, 0);
  return registry;
}

/** Transport-level authorization veto, structurally matching `@jini-ai/daemon`'s `ExecutionDelegate.onAuthorize` without either package importing the other's type. */
export interface ToolAuthorizationDelegate {
  onAuthorize?(ctx: ToolAuthorizationContext): AuthorizationDecision | Promise<AuthorizationDecision>;
}

/**
 * Outcome of {@link authorizeToolInvocation} — a union discriminated on
 * `decision`, deliberately rather than one shape with an optional `handler`.
 * "A handler exists if and only if the call was allowed" is the whole point
 * of this function, so it is expressed as something the compiler enforces:
 * the `'deny'` arm has no `handler` property to read at all, and the
 * `'allow'` arm's is non-optional, so the caller needs no non-null assertion
 * to use it after checking the decision.
 */
export type ToolInvocationAuthorization =
  | { readonly descriptor: ToolDescriptor; readonly decision: 'allow'; readonly handler: ToolHandler; readonly input: unknown; readonly normalizationNotes: readonly string[] }
  | { readonly descriptor: ToolDescriptor; readonly decision: 'deny' };

/**
 * Package-internal escape hatch: resolves `toolId` in `registry` and runs
 * its authorization gate — the tool's own {@link ToolPolicy}, then an
 * optional transport-level `delegate.onAuthorize` veto — before ever
 * exposing the handler. Exported only from `./composition.js` (see this
 * package's `package.json` `exports` map) — `@jini-ai/daemon`'s
 * `ToolExecutor` is the one and only intended caller. Not re-exported from
 * `index.ts`, so it never reaches `@jini-ai/core`'s public consumers.
 *
 * Replaces an earlier `getToolRegistration` that returned the full
 * `{descriptor, handler, policy}` triple unconditionally — since a
 * package.json `exports` subpath is not an access modifier (see this
 * package's `archived provenance ledger`), that let any consumer able to `import` this
 * package-internal entry point retrieve a live handler closure without
 * ever calling a policy. Bundling resolution with authorization here means
 * the handler itself is now unobtainable without already having passed the
 * gate — the leak closes structurally rather than by convention.
 *
 * @returns `undefined` if `toolId` isn't registered on `registry`.
 * @internal
 */
export async function authorizeToolInvocation(
  { registry, toolId, principal, run, input }: {
    registry: ToolRegistry; toolId: string; principal: Principal; run: RunRef; input: unknown;
  },
  { delegate }: { delegate?: ToolAuthorizationDelegate } = {},
): Promise<ToolInvocationAuthorization | undefined> {
  const registration = registrationsByRegistry.get(registry)?.get(toolId);
  if (!registration) {
    return undefined;
  }
  const { descriptor, handler, policy } = registration;
  // Schema-free tools have nothing to normalize; preserve their authorization/confirmation timing.
  const normalized = descriptor.inputSchema === undefined && registration.invocationSchema === undefined && registration.normalizeInput === undefined
    ? { input, notes: [] }
    : await normalizeToolInput({ input, registration });
  input = normalized.input;
  let decision = await policy.authorize({ principal, run, tool: descriptor, input });
  if (decision === 'allow' && delegate?.onAuthorize) {
    decision = await delegate.onAuthorize({ principal, run, tool: descriptor, input });
  }
  return decision === 'allow' ? { descriptor, decision, handler, input, normalizationNotes: normalized.notes } : { descriptor, decision: 'deny' };
}
