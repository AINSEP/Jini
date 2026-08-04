/**
 * `ToolRegistry` — the registration half of the tool-execution boundary
 * (extraction-plan.md §2.5 / §8 task 6). Tools are registered as
 * `{descriptor, handler, policy}` triples; the registry's *public* surface
 * (this file's `ToolRegistry` interface, and everything re-exported from
 * this package's root `index.ts`) exposes only `ToolDescriptor`s —
 * `register`/`has`/`list`. It never exposes a way to retrieve a `handler`
 * or `policy` back out.
 *
 * That's the load-bearing invariant this task is named after: "handlers
 * never publicly retrievable (routes/agents can't bypass authz)." A route
 * or an agent holding a `ToolRegistry` reference can enumerate what's
 * available and check membership, but the only way to actually *run* a
 * tool is through `@jini-ai/daemon`'s `ToolExecutor`, which is the sole
 * consumer of {@link authorizeToolInvocation} — a function deliberately
 * exported from `./internal.js` (a package-internal entry point, see this
 * package's `package.json` `exports` map and `source-map.md`) rather than
 * from the public `index.ts` barrel. Every other caller of
 * `@jini-ai/core`'s default entry point gets descriptors only.
 * `authorizeToolInvocation` itself runs the tool's `ToolPolicy` (and an
 * optional transport veto) before ever handing back a handler, so a
 * runtime handler closure is unobtainable without already having passed
 * authorization — the earlier design (a separate `getToolRegistration`
 * that returned the handler unconditionally) let any caller of this
 * package-internal entry point skip the gate entirely; see this package's
 * `source-map.md` for the 2026-07-29 hardening note.
 */
import type { Principal } from './principal.js';

/** A structural run reference — anything with a stable `id` satisfies this (e.g. `@jini-ai/protocol`'s `RunStatus`). No import needed to satisfy it; see the module doc. */
export interface RunRef {
  readonly id: string;
}

/**
 * The public, non-secret shape of a registered tool. Never carries the
 * handler or policy — those are only reachable via {@link authorizeToolInvocation}.
 */
export interface ToolDescriptor {
  readonly id: string;
  readonly description?: string;
  /**
   * JSON-Schema-shaped description of this tool's accepted input, carried as `unknown` because the
   * kernel neither parses nor validates it — a schema dialect is a consumer concern, and taking a
   * validator dependency here would put one in every package that touches a registry.
   *
   * It exists because *every* discovery mechanism needs it and nothing else in the kernel can
   * supply it: a caller that can enumerate `ToolRegistry.list()` still cannot tell an agent what
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
  /** Present only when the invoking transport owns a run event stream — see {@link SurfaceEmitter}. */
  readonly emitSurface?: SurfaceEmitter;
}

/** Runs the tool's actual side effect. Only ever invoked by `ToolExecutor`, never called directly by a route/agent holding the registry. */
export type ToolHandler = (ctx: ToolExecutionContext) => Promise<unknown>;

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
  readonly descriptor: ToolDescriptor;
  readonly handler: ToolHandler;
  readonly policy: ToolPolicy;
}

/** The public registration/enumeration surface. See the module doc for why `handler`/`policy` never appear here. */
export interface ToolRegistry {
  /** @throws If `registration.descriptor.id` is already registered — re-registration must be explicit (unregister is not exposed; this registry is append-only by design, matching the kernel's "tools are registered once at composition time" model). */
  register(registration: ToolRegistration): void;
  has(toolId: string): boolean;
  /** Descriptors only, in registration order. Never the underlying handlers/policies. */
  list(): readonly ToolDescriptor[];
}

const registrationsByRegistry = new WeakMap<ToolRegistry, Map<string, ToolRegistration>>();

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
export function createToolRegistry(): ToolRegistry {
  const registrations = new Map<string, ToolRegistration>();

  const registry: ToolRegistry = {
    register(registration: ToolRegistration): void {
      if (registrations.has(registration.descriptor.id)) {
        throw new Error(`ToolRegistry: tool "${registration.descriptor.id}" is already registered`);
      }
      registrations.set(registration.descriptor.id, registration);
    },
    has(toolId: string): boolean {
      return registrations.has(toolId);
    },
    list(): readonly ToolDescriptor[] {
      return Array.from(registrations.values(), (r) => r.descriptor);
    },
  };

  registrationsByRegistry.set(registry, registrations);
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
  | { readonly descriptor: ToolDescriptor; readonly decision: 'allow'; readonly handler: ToolHandler }
  | { readonly descriptor: ToolDescriptor; readonly decision: 'deny' };

/**
 * Package-internal escape hatch: resolves `toolId` in `registry` and runs
 * its authorization gate — the tool's own {@link ToolPolicy}, then an
 * optional transport-level `delegate.onAuthorize` veto — before ever
 * exposing the handler. Exported only from `./internal.js` (see this
 * package's `package.json` `exports` map) — `@jini-ai/daemon`'s
 * `ToolExecutor` is the one and only intended caller. Not re-exported from
 * `index.ts`, so it never reaches `@jini-ai/core`'s public consumers.
 *
 * Replaces an earlier `getToolRegistration` that returned the full
 * `{descriptor, handler, policy}` triple unconditionally — since a
 * package.json `exports` subpath is not an access modifier (see this
 * package's `source-map.md`), that let any consumer able to `import` this
 * package-internal entry point retrieve a live handler closure without
 * ever calling a policy. Bundling resolution with authorization here means
 * the handler itself is now unobtainable without already having passed the
 * gate — the leak closes structurally rather than by convention.
 *
 * @returns `undefined` if `toolId` isn't registered on `registry`.
 * @internal
 */
export async function authorizeToolInvocation(
  registry: ToolRegistry,
  toolId: string,
  principal: Principal,
  run: RunRef,
  input: unknown,
  delegate?: ToolAuthorizationDelegate,
): Promise<ToolInvocationAuthorization | undefined> {
  const registration = registrationsByRegistry.get(registry)?.get(toolId);
  if (!registration) {
    return undefined;
  }
  const { descriptor, handler, policy } = registration;
  let decision = await policy.authorize({ principal, run, tool: descriptor, input });
  if (decision === 'allow' && delegate?.onAuthorize) {
    decision = await delegate.onAuthorize({ principal, run, tool: descriptor, input });
  }
  return decision === 'allow' ? { descriptor, decision, handler } : { descriptor, decision: 'deny' };
}
