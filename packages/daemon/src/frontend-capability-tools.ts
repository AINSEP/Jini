/**
 * @module frontend-capability-tools
 *
 * The half of frontend control that makes it *reachable*. `FrontendSessionRegistry` can route a
 * call to the surface bound to a run, but a registry is not something an agent can call — only a
 * registered tool is. This module projects a frontend's capability manifest into
 * `{descriptor, handler, policy}` triples a host registers into the same `ToolRegistry` its
 * server-side tools live in.
 *
 * That projection is the entire point, and it is deliberately the ONLY door. Each handler is
 * invoked by `ToolExecutor` *after* authorization, confirmation, timeout, cancellation, output
 * truncation and audit have already run, and its whole body is "route this call and await the
 * answer". A route that called `registry.invoke` directly would reach the same tab having skipped
 * every one of those, which is precisely the second, weaker execution path this layering exists to
 * prevent. There is no reason to add one: anything that can execute a tool can execute these.
 *
 * **Typed structurally, not against the frontend packages.** A capability spec here is anything
 * with an `id` and a `description` — `@jini/agentic`'s `CapabilityDef` satisfies it without
 * knowing this module exists. Importing that type would point a server package at the browser
 * vocabulary and invert the one-way edge the engine's layering depends on; the same reasoning as
 * `@jini/core`'s `RunRef`.
 *
 * **Every registration carries a timeout by default.** A surface that never answers — a
 * backgrounded tab, a closed laptop, a tab killed between the call and the reply — is the normal
 * case here, not the exotic one, and `FrontendSessionRegistry.invoke` only rejects when its
 * caller's signal aborts. Without a `timeoutMs` on the descriptor that signal never fires and the
 * run waits forever, so the default is applied rather than left to each host to remember.
 */
import type { ToolPolicy, ToolRegistration } from '@jini/core';
import type { FrontendSessionRegistry } from './frontend-session-registry.js';

/**
 * Deny-by-default `ToolPolicy` for frontend capabilities, matching
 * `terminal-session.ts`'s `denyAllTerminalCreatePolicy` and `db-ops.ts`'s `denyAllDaemonDbPolicy`.
 *
 * A permissive default was rejected for the same reason as those: these tools drive a real user's
 * real screen — clicking controls, filling fields, navigating away from what they were reading —
 * and a host must opt into that explicitly, not acquire it merely by registering a manifest.
 */
export const denyAllFrontendCapabilityPolicy: ToolPolicy = {
  authorize: () => 'deny',
};

/**
 * How long a handler waits for the surface before `ToolExecutor` aborts it and reports
 * `'timed-out'`. Generous enough for a slow render or a busy main thread, short enough that a tab
 * that is never coming back fails the tool call rather than the whole run.
 */
export const DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS = 30_000;

/**
 * The minimum a manifest entry must describe. Structural on purpose — see the module doc.
 *
 * Every field here exists on `@jini/agentic`'s `CapabilityDef`, so a manifest satisfies this
 * without conversion. The first version of this type accepted only `id`, `description`, and
 * `requiresConfirmation` and silently dropped the rest, which made the projection **lossy**: a
 * registered capability could no longer say what arguments it took or how dangerous it was, so
 * nothing downstream could describe it to an agent or reason about it. Discovery cannot be correct
 * on top of a projection that has already thrown the answer away.
 */
export interface FrontendCapabilitySpec {
  readonly id: string;
  readonly description: string;
  /** Surfaced on the descriptor so `ToolExecutor`'s confirmation gate enforces it. */
  readonly requiresConfirmation?: boolean;
  /** Carried onto `ToolDescriptor.inputSchema` so a discovery surface can state the arguments. */
  readonly inputSchema?: unknown;
}

/**
 * Deliberately NOT projected yet: `CapabilityDef`'s `risk` and `surface`.
 *
 * They belong on whatever a discovery surface returns — `risk` labels how dangerous a capability
 * is, and `surface` says whether "no frontend is bound" is a temporary condition or a permanent
 * refusal, which decides whether a caller should wait or give up. But nothing reads them until
 * that surface exists, and a public type carrying fields no code consumes is indistinguishable
 * from one carrying fields whose consumer was deleted. They graduate here when the catalog that
 * needs them lands, together with the decision about whether they belong on `ToolDescriptor` (and
 * so on `ToolRegistry.list()`) or are joined from the host's manifest.
 *
 * A host still loses nothing today: a `CapabilityDef` satisfies {@link FrontendCapabilitySpec}
 * structurally with those fields intact on the value it already holds.
 */

export interface CreateFrontendCapabilityRegistrationsOptions {
  readonly registry: FrontendSessionRegistry;
  /** The capabilities to expose. Ids become tool ids verbatim, so an agent names `page.click`. */
  readonly capabilities: readonly FrontendCapabilitySpec[];
  /** @default {@link denyAllFrontendCapabilityPolicy} — see its doc for why a permissive default was rejected. */
  readonly policy?: ToolPolicy;
  /** @default {@link DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS} — see the module doc for why this is defaulted rather than optional. */
  readonly timeoutMs?: number;
  /** Passed through to every descriptor. Frontend output is untrusted text; a host that reads it back into a prompt should bound it. */
  readonly maxOutputBytes?: number;
}

/**
 * Normalizes a tool's `unknown` input into the record `FrontendSessionRegistry.invoke` takes.
 *
 * A missing input is `{}` — several capabilities legitimately take no arguments, and forcing a
 * caller to send an empty object to use them would be noise. Anything else non-object is a caller
 * error reported by name, not silently coerced into `{}`, which would turn "you sent a string"
 * into the much more confusing "the capability says a required field is missing".
 */
function toCapabilityInput(capabilityId: string, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      `${capabilityId}: input must be a JSON object, received ${Array.isArray(input) ? 'array' : typeof input}`,
    );
  }
  return input as Record<string, unknown>;
}

/**
 * Builds one `ToolRegistration` per capability, each routing through `registry.invoke` on the
 * calling run's bound surface.
 *
 * @param options - The registry to route through, the manifest to expose, and the gate to apply.
 * @returns Registrations in manifest order, ready to hand to a `ToolRegistry` (or to
 * `@jini/node-host`'s `toolRegistrations` config option).
 * @throws Never. A duplicate id is reported by `ToolRegistry.register` at registration time,
 * naming the id — this function does not pre-empt that with a second, differently-worded error.
 *
 * @complexity O(n) in `capabilities`; each handler is O(1) plus the round trip to the surface.
 */
export function createFrontendCapabilityRegistrations(
  options: CreateFrontendCapabilityRegistrationsOptions,
): readonly ToolRegistration[] {
  const {
    registry,
    capabilities,
    policy = denyAllFrontendCapabilityPolicy,
    timeoutMs = DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS,
    maxOutputBytes,
  } = options;

  return capabilities.map((capability) => ({
    descriptor: {
      id: capability.id,
      description: capability.description,
      timeoutMs,
      ...(capability.requiresConfirmation !== undefined
        ? { requiresConfirmation: capability.requiresConfirmation }
        : {}),
      // Absent rather than `undefined`: a descriptor that *has* an `inputSchema` key holding
      // `undefined` is indistinguishable from one describing a schemaless tool once serialized,
      // and a catalog would render "takes no arguments" for a capability that takes several.
      ...(capability.inputSchema !== undefined ? { inputSchema: capability.inputSchema } : {}),
      ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    },
    policy,
    // `ctx.signal` is `ToolExecutor`'s own timeout/cancel signal, so the descriptor's `timeoutMs`
    // and a cancelled run both reach the pending invocation without this module owning a timer.
    handler: async (ctx) =>
      registry.invoke(
        ctx.run.id,
        capability.id,
        toCapabilityInput(capability.id, ctx.input),
        ctx.signal,
      ),
  }));
}
