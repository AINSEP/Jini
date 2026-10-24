import { isReadOnlyTool, toolDiscoveryMetadata, type Principal, type ToolRegistry } from '@jini-ai/core';
import type { ToolExecutor } from '../tool-executor.js';
import type { IdGenerator } from '@jini-ai/core/primitives';
import { toolCandidates } from './tool-candidates.js';
import type { ToolCatalogQuery } from '../http/tool-catalog.js';

/**
 * A `Principal` narrowed to tools that only read.
 *
 * An HTTP route preflight only ever validates the OUTER `toolId` — the one the caller
 * named in the HTTP request. It cannot see what a consumer's own `ToolExecutor` composition does
 * once `bridge.execute()` hands control to `deps.toolExecutor`: a decorator that composition
 * stacks on top of the bare executor (a recovery loop that retries through a different tool id
 * after a failure, for instance) can dispatch a tool the caller never named, using the exact same
 * `principal` the outer call carried — one hop past the only check the HTTP route ever ran. Adding a
 * second request-shaped flag would not close that gap either: it would have to be threaded, by
 * hand, through every decorator between here and the handler, and a decorator that forgot would
 * fail open silently. `principal` is the one value every layer already passes unchanged, so the
 * constraint travels as an ATTENUATED IDENTITY instead — a principal permitted to invoke only
 * read-only tools, checkable by {@link refuseNonReadOnlyDispatch} at any depth a consumer's own
 * composition cares to ask.
 *
 * A distinct field rather than a `Principal.roles` entry: `roles` is what a `ToolPolicy` branches
 * on, and a synthetic role would silently join that decision for every registration in the
 * process. This field is inert to everything except {@link refuseNonReadOnlyDispatch}.
 */
export interface ReadOnlyConstrainedPrincipal extends Principal {
  readonly toolAccess: 'read-only';
}

/**
 * Default daemon refusal wording, replaceable by the host. Unknown registrations and writes both
 * refuse unsafe dispatch; unknown ids direct discovery because an unrestricted retry cannot run them.
 * Missing verification metadata always refuses, naming the missing wiring so the host can fix it.
 */
export const defaultDaemonMessages = {
  readOnly: {
    unverifiableMessage: 'this host cannot verify read-only tools — POST /api/delegated-tool-calls was mounted without DelegatedToolsHttpDeps.toolRegistry, so a requireReadOnly call cannot be checked and is refused',
    toolRefusalMessage: ({ toolId }: { toolId: string }) =>
      `tool "${toolId}" is not registered as read-only — this gateway executes only tools whose registration declares readOnly; call it through execute_delegated_tool instead`,
    unknownToolMessage: ({ toolId, candidates }: { toolId: string; candidates: readonly string[] }) =>
      `no tool "${toolId}" is registered; use search_tools${candidates.length > 0 ? ` — did you mean ${candidates.join(', ')}?` : ''}`,
  },
};

/** Required host wording; absent metadata is always a refusal. */
export interface ReadOnlyToolMessages {
  readonly unverifiableMessage: string;
  toolRefusalMessage(required: { toolId: string }): string;
  unknownToolMessage(required: { toolId: string; candidates: readonly string[] }): string;
}

export interface ReadOnlyToolCheckRequired {
  readonly toolId: string;
  /** Diagnostic selector only; never changes which registration is checked or executed. */
  readonly input?: unknown;
  readonly registry: Pick<ToolRegistry, 'list'> | undefined;
  readonly messages: ReadOnlyToolMessages;
}

// Registry is required-but-nullable so wiring must explicitly choose what can verify a call;
// the missing case denies constrained dispatches rather than waiving their safety check.
export interface ReadOnlyToolConstraintRequired {
  readonly inner: ToolExecutor;
  readonly registry: Pick<ToolRegistry, 'list'> | undefined;
  readonly idGenerator: IdGenerator;
  readonly messages: ReadOnlyToolMessages;
}

/** @returns A copied, attenuated principal; its roles are unchanged. */
export function constrainPrincipalToReadOnlyTools(
  { principal }: { principal: Principal },
  _optional: Record<string, never> = {},
): ReadOnlyConstrainedPrincipal {
  return { ...principal, toolAccess: 'read-only' };
}

// Read structurally so passing through layers typed as the base Principal cannot erase the
// execution's authority constraint.
/** @returns Whether attenuation survived the executor/decorator boundary. */
export function principalIsReadOnlyConstrained(
  { principal }: { principal: Principal },
  _optional: Record<string, never> = {},
): boolean {
  return 'toolAccess' in principal && principal.toolAccess === 'read-only';
}

/**
 * Hide writes and unclassified tools from a constrained caller's search and schema discovery.
 * Uses the same classification as dispatch; discovery never grants execution authority.
 * @param required - Per-call identity, live descriptors, and the existing catalog owner.
 * @returns A filtered catalog, or the original catalog for an unconstrained caller.
 * @example filterReadOnlyToolCatalog({ principal, registry, catalog });
 * @complexity O(n + h) per search for n live registrations and h ranked hits. Overfetch is bounded
 * by registered tool count so withheld writes cannot displace permitted reads at a small limit.
 */
export function filterReadOnlyToolCatalog(
  required: { principal: Principal; registry: Pick<ToolRegistry, 'list'>; catalog: ToolCatalogQuery },
  _optional: Record<string, never> = {},
): ToolCatalogQuery {
  if (!principalIsReadOnlyConstrained({ principal: required.principal })) return required.catalog;
  const allowedTools = () => new Map(required.registry.list({})
    .filter(descriptor => isReadOnlyTool({ descriptor })).map(descriptor => [descriptor.id, descriptor]));
  return {
    search(input, { limit = 10 } = {}) {
      const allowed = allowedTools();
      return required.catalog.search(input, { limit: Math.max(limit, required.registry.list({}).length) })
        .filter(hit => allowed.has(hit.id)).slice(0, limit)
        .map(hit => ({ ...hit, ...toolDiscoveryMetadata({ descriptor: allowed.get(hit.id) }) }));
    },
    describe(input) {
      const descriptor = allowedTools().get(input.id);
      const entry = descriptor ? required.catalog.describe(input) : null;
      return entry ? { ...entry, ...toolDiscoveryMetadata({ descriptor }) } : null;
    },
  };
}

/** @returns Required host wording for a registered non-read-only tool. */
export function readOnlyToolRefusalMessage(
  { toolId, messages }: { toolId: string; messages: ReadOnlyToolMessages },
  _optional: Record<string, never> = {},
): string {
  return messages.toolRefusalMessage({ toolId });
}

// Unknown registrations and omitted read-only classification both lack evidence of safety.
// Every dispatch/preflight consults this decision; recovery preflight prevents asking a human
// for form input that the innermost gate would refuse after submission.
/**
 * Single read-only registration decision, shared by routes and inner dispatch.
 * @returns Null for an explicitly read-only registration, otherwise host refusal text.
 * @complexity O(n) for known tools; unknown-tool diagnostics add bounded name scoring and O(n log n) sorting.
 */
export function checkReadOnlyTool(
  { toolId, input, registry, messages }: ReadOnlyToolCheckRequired,
  _optional: Record<string, never> = {},
): string | null {
  if (registry === undefined) return messages.unverifiableMessage;
  const tools = registry.list({});
  const descriptor = tools.find((candidate) => candidate.id === toolId);
  if (!descriptor) return messages.unknownToolMessage({ toolId, candidates: toolCandidates({ toolId, tools, input }) });
  if (isReadOnlyTool({ descriptor })) return null;
  return readOnlyToolRefusalMessage({ toolId, messages });
}

/**
 * THE read-only dispatch decision for any tool id a consumer's own `ToolExecutor` composition is
 * about to invoke — the outer call the route already checked, or a nested one a decorator issues
 * one or more hops in. Every consumer's own composition should ask this before dispatching on
 * behalf of a principal it did not itself resolve; none should re-implement the check, so changing
 * what the constraint means stays one edit.
 *
 * @param required.principal - The principal the dispatch would run under. Unconstrained ⇒ always
 *   `null` — this is a no-op for every pre-existing caller that never attenuates a principal.
 * @param required.toolId - The id actually about to be dispatched, which is not necessarily the id
 *   named in the original request — that difference is the whole reason this function exists.
 * @param required.registry - Descriptors to resolve `toolId` against; `undefined` ⇒ refuse (an
 *   unverifiable constrained dispatch is refused, never waived, matching `checkReadOnlyTool`).
 * @returns `null` when the dispatch may proceed, otherwise the refusal text to report.
 * @complexity O(1) for an unconstrained principal; O(n) in registered tool count for a known tool,
 *   since `ToolRegistry` exposes enumeration rather than lookup by id. Unknown ids also incur
 *   the bounded similarity scoring and sorting cost documented by `toolCandidates`.
 */
export function refuseNonReadOnlyDispatch(
  required: ReadOnlyToolCheckRequired & { readonly principal: Principal },
  _optional: Record<string, never> = {},
): string | null {
  if (!principalIsReadOnlyConstrained({ principal: required.principal })) return null;
  return checkReadOnlyTool(required);
}

// Report the original failure alongside the refused remedy; silently hiding an automatic
// recovery attempt would mislead the caller even when the constraint correctly prevents writes.
/** @returns Caller-formatted recovery refusal, preserving the original refusal verbatim as input. */
export function readOnlyRemedyRefusalMessage(
  { refusal, formatMessage }: { refusal: string; formatMessage: (required: { refusal: string }) => string },
  _optional: Record<string, never> = {},
): string {
  return formatMessage({ refusal });
}

// A route can validate the caller's read-only tool and still miss a recovery decorator choosing
// a writing remedy afterward. Enforce on every actual dispatch at the innermost executor to
// close that class of authority laundering, including dispatchers introduced later.
/**
 * Wraps `inner` so a read-only-constrained principal (one {@link constrainPrincipalToReadOnlyTools}
 * attenuated) cannot dispatch a tool that isn't registered read-only — whichever layer chose the
 * id. This is what turns the attenuation into an actual gate rather than a field nobody reads:
 * {@link refuseNonReadOnlyDispatch} is the decision, this is its enforcement point.
 *
 * **Compose this as close to the bare `ToolExecutor` as your own stack allows** — directly around
 * `@jini-ai/daemon`'s `createToolExecutor` output, beneath any decorator of your own that might
 * dispatch a tool id the caller never named (a retry, a recovery loop that calls a different tool
 * as a remedy, ...). Every such decorator's own `inner.execute` call still has to come through here
 * to reach a handler, which is what makes this a gate on the CLASS of defect (an unnamed nested
 * dispatch) rather than on one instance of it.
 *
 * `delegatedToolExecuteRoute`'s own `handle` additionally composes this around whatever
 * `ToolExecutor` a host supplies, whenever a call attenuates its principal. That outer composition
 * only re-covers the SAME outer `toolId` the route preflight already checked — it
 * cannot see a nested dispatch a host's own inner decorator issues, because that decorator holds a
 * reference to whatever `ToolExecutor` IT was built with, not to the HTTP route's wrapped one. Closing
 * the nested case for a given host's stack requires that host to compose this decorator itself,
 * innermost, in its own `ToolExecutor` construction — this export exists so it can, without having
 * to rediscover or reimplement the mechanism.
 *
 * @returns A drop-in `ToolExecutor`; `resumeConfirmation`/`cancel`/`getAuditRecord` delegate
 *   straight through.
 * @complexity One extra property read per unconstrained call; one registry scan per constrained one,
 *   plus bounded similarity scoring and sorting for an unknown id.
 */
export function withReadOnlyToolConstraint(
  { inner, registry, idGenerator, messages }: ReadOnlyToolConstraintRequired,
  _optional: Record<string, never> = {},
): ToolExecutor {
  return {
    execute: async (requiredArgs, optionalArgs = {}) => {
      const { principal, toolId, input } = requiredArgs;
      const refusal = refuseNonReadOnlyDispatch({ principal, toolId, input, registry, messages });
      // Deny before inner: no handler or kernel audit record exists. Use the authorization result
      // union instead of throwing, and mint a denial ID because there is no inner execution ID.
      if (refusal !== null) return { executionId: idGenerator.newId(), status: 'denied', error: refusal };
      return inner.execute(requiredArgs, optionalArgs);
    },
    resumeConfirmation: (requiredArgs) => inner.resumeConfirmation(requiredArgs),
    cancel: (requiredArgs) => inner.cancel(requiredArgs),
    getAuditRecord: (requiredArgs) => inner.getAuditRecord(requiredArgs),
  };
}
