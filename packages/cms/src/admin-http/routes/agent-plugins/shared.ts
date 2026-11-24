import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { AgentPluginRowCandidate } from "../../http/agent-plugins.js";

/** @file Shared guards and host-collaborator types for the `agent-plugins` admin route specs. */

/** The principal fields these routes read: only the id, as the activation record's actor. */
export interface AgentPluginRoutePrincipal { id: string }

/** The host's installed-plugin read model (one source of truth with the assistant's plugin search tool). */
export type AgentPluginCandidatesLoader = (required?: Record<string, never>, optional?: Record<string, never>) => Promise<readonly AgentPluginRowCandidate[]>;

/** The entity type a by-id check names; the hand-written set-enabled route passed this same value. */
const AGENT_PLUGIN_ENTITY_TYPE = "agent-plugin";

/**
 * Asks the host for one `admin.plugins.*` permission. A by-id route names the plugin
 * (`entityType: "agent-plugin"` plus `entityId`), as the hand-written set-enabled route did.
 *
 * An id-free route (list, files) named NO entity type in its hand-written form, but the port's
 * contract requires a string, so it sends the placeholder `""`. That placeholder is NOT inert: a
 * policy row may carry an empty resource type, which `""` would match where an absent type cannot.
 * The host's binding for these id-free mounts must therefore drop `entityType` before its
 * authorizer sees it (Tovu: `idFreeAgentPluginPortDeps` in `agent-plugins-routes.ts`). Naming
 * `"agent-plugin"` here instead would newly admit a grant scoped to that type.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeAgentPlugins(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("agent-plugins admin route has no authorizer");
  if (optional.entityId === undefined) { await authorize({ permission, entityType: "" }); return; }
  await authorize({ permission, entityType: AGENT_PLUGIN_ENTITY_TYPE }, { entityId: optional.entityId });
}

/** The authenticated principal's id, recorded as the activation's actor. @complexity O(1). */
export function agentPluginActorId({ context }: { context: AgentPluginRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("agent-plugins admin route has no authenticated principal");
  return context.id;
}

/** The `:pluginId` path segment; Express always fills it, the `?? ""` mirrors the host's own read. @complexity O(1). */
export function pluginIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.pluginId ?? "");
}

/** A lifecycle error that carries its own stable code and a plain, path-free message. */
export interface AgentPluginCodedError { readonly message: string; readonly code: string }

/**
 * The host's error classes set-enabled maps, as `instanceof` predicates bound by the registrar from
 * the real classes (they live in packages this one may not depend on, and in the host itself).
 */
export interface AgentPluginSetEnabledErrorPredicates {
  /** The roster change would lower a running tool's access and could not be applied (503). */
  readonly toolAccessLowering: (error: unknown) => error is AgentPluginCodedError;
  readonly hostIncompatible: (error: unknown) => error is AgentPluginCodedError;
  readonly update: (error: unknown) => error is AgentPluginCodedError;
  readonly notReady: (error: unknown) => error is AgentPluginCodedError;
  readonly linked: (error: unknown) => error is AgentPluginCodedError & { readonly providerPluginId: string };
  readonly notInstalled: (error: unknown) => error is Error;
  readonly activationsUnreadable: (error: unknown) => error is Error;
  readonly activationsBusy: (error: unknown) => error is Error;
}

/**
 * The host's fixed, path-free text for the two activation-record faults (host copy: it names the
 * host's own processes and repair story, so the host owns it).
 */
export interface AgentPluginSetEnabledCopy { readonly activationsUnreadable: string; readonly activationsBusy: string }

/** The two set-enabled refusals whose real cause (it may name host paths) stays server-side. */
export type AgentPluginSetEnabledHostFault = "activationsUnreadable" | "activationsBusy";

/**
 * The structured facts set-enabled reports for a host-fault refusal. The host owns the log label
 * and message format; this package only says what happened.
 */
export interface AgentPluginSetEnabledRefusalDiagnostic {
  readonly pluginId: string;
  readonly refusal: AgentPluginSetEnabledHostFault;
  /** The caught error's own message, for the server log only (never the response body). */
  readonly causeMessage: string;
}

/** The host's sink for {@link AgentPluginSetEnabledRefusalDiagnostic}s (Tovu formats and logs them). */
export type AgentPluginSetEnabledDiagnosticSink = (required: AgentPluginSetEnabledRefusalDiagnostic) => void;

type SetEnabledRefusal = (required: { error: AgentPluginCodedError & { readonly providerPluginId?: string }; copy: AgentPluginSetEnabledCopy }) => { status: number; body: Record<string, unknown> };

/**
 * One `catch` rung: the predicate it asks, the refusal it answers, and — for the two host-fault
 * rungs only — that its cause is reported to the host's diagnostic sink.
 */
type SetEnabledErrorRung =
  | { readonly kind: AgentPluginSetEnabledHostFault; readonly refusal: SetEnabledRefusal; readonly diagnose: true }
  | { readonly kind: Exclude<keyof AgentPluginSetEnabledErrorPredicates, AgentPluginSetEnabledHostFault>; readonly refusal: SetEnabledRefusal; readonly diagnose?: undefined };

const ownCodeConflict: SetEnabledErrorRung["refusal"] = ({ error }) => ({ status: 409, body: { code: error.code, error: error.message } });

/**
 * set-enabled's ladder, in the hand-written order:
 *
 * - `AgentPluginNotInstalledError`: `setAgentPluginEnabled` re-asserts the installed precondition
 *   independently of the handler's own `candidates` lookup, so a package removed between the two
 *   reads lands here rather than as an opaque 500 — the same 404 the pre-check produces, for the
 *   same reason.
 * - `AgentPluginActivationsUnreadableError`: t91 F1.1 (2026-09-16) — the activations file exists
 *   but could not be read. Nothing was written — `setAgentPluginEnabled` refuses before any write,
 *   per `activation.ts`'s "Writers never rewrite what they could not read". The host path stays in
 *   the server log only; the response body carries the fixed, path-free E2 text.
 * - `AgentPluginActivationsBusyError`: t91 R2 (2026-09-16) — another host process (API, agent
 *   daemon, or the `agent-plugin:activation` CLI) held the cross-process write lock and the wait
 *   timed out, or this process lost the lock before it could commit. Nothing was written either
 *   way — see `activation.ts`'s `lockedActivationsWrite`. The host lock path stays in the server
 *   log only; the response body is fixed and path-free, like the UNREADABLE case above.
 * - Anything else: opaque 500, matching every other route in this admin surface.
 */
const SET_ENABLED_ERROR_RUNGS: readonly SetEnabledErrorRung[] = [
  { kind: "toolAccessLowering", refusal: ({ error }) => ({ status: 503, body: { error: error.message, code: error.code } }) },
  // Not for this host (enable only), or an interrupted update awaits boot recovery
  // (PLUGIN_UPDATE_PENDING): both conflicts with the installed state, never a 500.
  { kind: "hostIncompatible", refusal: ownCodeConflict },
  { kind: "update", refusal: ownCodeConflict },
  // A "Soon" plugin is locked off (`features/agent-plugins/soon-lock.ts`); nothing was written.
  { kind: "notReady", refusal: ownCodeConflict },
  // A provider plugin's assistant face: its provider plugin's switch decides; nothing was written.
  { kind: "linked", refusal: ({ error }) => ({ status: 409, body: { code: error.code, error: error.message, providerPluginId: error.providerPluginId } }) },
  { kind: "notInstalled", refusal: ({ error }) => ({ status: 404, body: { error: error.message, code: "AGENT_PLUGIN_NOT_FOUND" } }) },
  {
    kind: "activationsUnreadable", diagnose: true,
    refusal: ({ copy }) => ({ status: 409, body: {
      error: copy.activationsUnreadable,
      code: "AGENT_PLUGIN_ACTIVATIONS_UNREADABLE",
    } }),
  },
  {
    kind: "activationsBusy", diagnose: true,
    refusal: ({ copy }) => ({ status: 409, body: {
      error: copy.activationsBusy,
      code: "AGENT_PLUGIN_ACTIVATIONS_BUSY",
    } }),
  },
];

/**
 * Refuses with the first matching rung (reporting the two host-fault rungs' real cause to the
 * injected `diagnose` sink); anything unmapped — including a refusal thrown earlier in the
 * handler — is rethrown unchanged, so the host's error port answers it.
 * @complexity O(n) in the rung count, a fixed list of eight.
 */
export function rejectSetEnabledError(
  { error, pluginId, isError, diagnose, copy }: {
    error: unknown; pluginId: string; isError: AgentPluginSetEnabledErrorPredicates; diagnose: AgentPluginSetEnabledDiagnosticSink; copy: AgentPluginSetEnabledCopy;
  },
  _optional: Record<string, never> = {},
): never {
  const rung = SET_ENABLED_ERROR_RUNGS.find((candidate) => isError[candidate.kind](error));
  if (!rung) throw error;
  const coded = error as AgentPluginCodedError & { readonly providerPluginId?: string };
  if (rung.diagnose) diagnose({ pluginId, refusal: rung.kind, causeMessage: coded.message });
  throw new RouteRefusalError(rung.refusal({ error: coded, copy }));
}
