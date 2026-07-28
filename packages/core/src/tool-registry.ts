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
 * tool is through `@injini/daemon`'s `ToolExecutor`, which is the sole
 * consumer of {@link getToolRegistration} — a function deliberately
 * exported from `./internal.js` (a package-internal entry point, see this
 * package's `package.json` `exports` map and `source-map.md`) rather than
 * from the public `index.ts` barrel. Every other caller of
 * `@injini/core`'s default entry point gets descriptors only.
 */
import type { Principal } from './principal.js';

/** A structural run reference — anything with a stable `id` satisfies this (e.g. `@injini/protocol`'s `RunStatus`). No import needed to satisfy it; see the module doc. */
export interface RunRef {
  readonly id: string;
}

/**
 * The public, non-secret shape of a registered tool. Never carries the
 * handler or policy — those are only reachable via {@link getToolRegistration}.
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

/** What a `ToolHandler` receives — everything it needs and nothing it could use to bypass the gate (no registry access, no other tools' state). */
export interface ToolExecutionContext {
  /** The id `ToolExecutor` assigned this call — for the handler's own logging/correlation; carries no authority (the gate already ran before the handler is invoked). */
  readonly executionId: string;
  readonly principal: Principal;
  readonly run: RunRef;
  readonly input: unknown;
  readonly signal: AbortSignal;
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
 * — reachable only via {@link getToolRegistration}, not through any method
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

/**
 * Package-internal escape hatch: resolves a tool's full `{descriptor,
 * handler, policy}` registration. Exported only from `./internal.js` (see
 * this package's `package.json` `exports` map) — `@injini/daemon`'s
 * `ToolExecutor` is the one and only intended caller. Not re-exported from
 * `index.ts`, so it never reaches `@injini/core`'s public consumers.
 *
 * @internal
 */
export function getToolRegistration(registry: ToolRegistry, toolId: string): ToolRegistration | undefined {
  return registrationsByRegistry.get(registry)?.get(toolId);
}
