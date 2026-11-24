import { defineJsonRoute, ok, type JsonRouteAuthorize, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { JsonValue } from "@jini-ai/core/primitives";
import { deriveRequiredPermission } from "@jini-ai/core/settings";

import {
  runSettingsRoute, settingsRouteInput,
  type SettingsRouteInput, type SettingsRoutePrincipal, type SettingsWriteRouteBaseDeps,
} from "../settings/shared.js";

/**
 * @file Shared site-owner grant ceremony over the existing audited settings chokepoint.
 *
 * For grants requiring acknowledgment, a receipt is persisted before enabling: failure can leave a
 * receipt, never an unacknowledged grant. Grants that need no acknowledgment (e.g. a per-agent
 * toggle) need only the owner's ordinary write. Every value change has its normal atomic setting
 * revision; no alternate store or schema. Each concrete grant (its coordinates, parsing, projection
 * and write hooks) is an `OwnerGrantPolicy` built by its own route file from its own deps.
 *
 * The routes run through `runSettingsRoute`, in the settings order: readiness, then the principal
 * (a missing session is the host's fixed 500), then (PUT only) the protected-namespace fence, then
 * the body. Unexpected failures are rethrown for the host's redacted 500.
 */

/** A request body as the grant handlers read it. */
export type OwnerGrantBody = Record<string, unknown>;

/** One concrete owner grant: where it is stored, how a body becomes a value, and its write hooks. */
export interface OwnerGrantPolicy<T extends { enabled: boolean }> {
  namespace: string;
  key: string;
  /** 403 copy for a non-owner write. */
  writeReason: string;
  /** 400 copy for a malformed body or a missing acknowledgment. */
  validationError: string;
  read(): Promise<T>;
  parse(required: { body: OwnerGrantBody }, optional?: Record<string, never>): T;
  value(required: { settings: T }, optional?: Record<string, never>): JsonValue;
  prepareWrite?(input: { body: OwnerGrantBody; settings: T; previous: T }): Promise<{ value: JsonValue; revisionSeq: number }>;
  afterWrite?(input: { settings: T; previous: T; body: OwnerGrantBody }): Promise<T | void>;
  projectRead?(input: { settings: T; isOwner: boolean }): object;
  canEdit?(input: { isOwner: boolean }): boolean;
  /** 403 copy when `canEdit` refuses even the owner (host policy). */
  uneditableError?: string;
  /** Acknowledged enable (receipt first); on unless `false`. */
  requireAcknowledgment?: boolean;
  scope?: "user" | "workspace";
}

/** The ledger write the grant performs (the receipt and the value), with the scope's identity fields. */
export interface OwnerGrantWriteInput {
  namespace: string; key: string; value: JsonValue; scope: "user" | "workspace"; principalId?: string;
  workspaceId: string; authWorkspaceId: string; callerPrincipalId: string;
}

/** The host's audited settings write (keeps its own inner authorization and revision). */
export type OwnerGrantWriteFn = (
  required: { input: OwnerGrantWriteInput },
  optional?: { expectedRevisionSeq?: number },
) => Promise<{ revisionSeq: number }>;

/** The deps an owner-grant route reads: the settings write base, the site owner, a clock and the writer. */
export interface AssistantOwnerGrantRouteDeps extends SettingsWriteRouteBaseDeps {
  ownerPrincipalId: PromiseLike<string>;
  clock: { nowIso(): string };
  writeSetting: OwnerGrantWriteFn;
}

type GrantContext<T extends { enabled: boolean }> = { deps: AssistantOwnerGrantRouteDeps; policy: OwnerGrantPolicy<T>; principal: SettingsRoutePrincipal };

/** GET: visible to every authenticated administrator, owner or not.
 * @complexity O(1) plus the policy's read. */
async function readGrant<T extends { enabled: boolean }>({ deps, policy, principal }: GrantContext<T>, _optional = {}) {
  // The dock is available to every authenticated administrator, including those without
  // settings.read. These non-secret grants must remain visible to everyone they affect.
  const isOwner = principal.id === await deps.ownerPrincipalId;
  const settings = await policy.read();
  return { ...(policy.projectRead?.({ settings, isOwner }) ?? settings), canEdit: policy.canEdit?.({ isOwner }) ?? isOwner };
}

/** Body shape and acknowledgment checks, before any write; reads the stored grant once.
 * @complexity O(1) plus the policy's parse and read. */
async function parseGrantUpdate<T extends { enabled: boolean }>({ policy, body }: { policy: OwnerGrantPolicy<T>; body: OwnerGrantBody | null }, _optional = {}) {
  if (!body || Array.isArray(body) || typeof body.enabled !== "boolean") rejectRoute({ status: 400, code: "VALIDATION_ERROR", error: policy.validationError });
  const settings = policy.parse({ body });
  const previous = await policy.read();
  const needsAcknowledgment = policy.requireAcknowledgment !== false && settings.enabled && !previous.enabled;
  if (needsAcknowledgment && body.riskAcknowledged !== true) rejectRoute({ status: 400, code: "VALIDATION_ERROR", error: policy.validationError });
  return { body, settings, previous, needsAcknowledgment };
}

/** Receipt (when acknowledged), then the value at the prepared revision, then the after-write hook.
 * @complexity At most two ledger writes plus the policy hooks. */
async function persistGrant<T extends { enabled: boolean }>(
  { deps, policy, input, update }: { deps: AssistantOwnerGrantRouteDeps; policy: OwnerGrantPolicy<T>; input: Omit<OwnerGrantWriteInput, "key" | "value">; update: Awaited<ReturnType<typeof parseGrantUpdate<T>>> },
  _optional = {},
) {
  const { body, settings, previous, needsAcknowledgment } = update;
  if (needsAcknowledgment) await deps.writeSetting({ input: {
    ...input, key: "riskAcknowledgment", value: { riskAcknowledged: true, acknowledgedAt: deps.clock.nowIso(), grant: policy.value({ settings }) },
  } });
  const prepared = await policy.prepareWrite?.({ body, settings, previous });
  const result = await deps.writeSetting({ input: { ...input, key: policy.key, value: prepared?.value ?? policy.value({ settings }) } },
    prepared ? { expectedRevisionSeq: prepared.revisionSeq } : {});
  const savedSettings = await policy.afterWrite?.({ settings, previous, body });
  return { revisionSeq: result.revisionSeq, settings: savedSettings ?? settings };
}

/** PUT: owner only, then host edit policy, then body checks, then the scope's write permission.
 * @complexity O(1) plus parse, authorization and at most two ledger writes. */
async function writeGrant<T extends { enabled: boolean }>(
  { deps, policy, principal, authorize, body }: GrantContext<T> & { authorize: JsonRouteAuthorize; body: unknown },
  _optional = {},
) {
  if (principal.id !== await deps.ownerPrincipalId) rejectRoute({ status: 403, code: "FORBIDDEN", error: policy.writeReason });
  if (policy.canEdit && !policy.canEdit({ isOwner: true })) rejectRoute({ status: 403, code: "FORBIDDEN", error: policy.uneditableError ?? policy.writeReason });
  const update = await parseGrantUpdate({ policy, body: body as OwnerGrantBody | null });
  const scope = policy.scope ?? "workspace";
  await authorize({ permission: deriveRequiredPermission({ scope, callerPrincipalId: principal.id }), entityType: "setting-value" });
  const input = { namespace: policy.namespace, scope, ...(scope === "user" ? { principalId: principal.id } : {}),
    workspaceId: deps.workspaceId, authWorkspaceId: deps.workspaceId, callerPrincipalId: principal.id };
  const result = await persistGrant({ deps, policy, input, update });
  return { ...(policy.projectRead?.({ settings: result.settings, isOwner: true }) ?? result.settings), canEdit: true, revisionSeq: result.revisionSeq };
}

type GrantSpec = JsonRouteSpec<SettingsRouteInput, Record<string, unknown>, AssistantOwnerGrantRouteDeps, SettingsRoutePrincipal>;

/**
 * The GET/PUT pair of one owner grant on `path`. The host mounts both, GET first.
 * @complexity O(1) construction; per request as `readGrant`/`writeGrant`.
 */
export function createOwnerGrantRoutes<T extends { enabled: boolean }>(
  required: { path: string; policy: OwnerGrantPolicy<T> },
  _optional: Record<string, never> = {},
): { get: GrantSpec; put: GrantSpec } {
  const { path, policy } = required;
  return {
    get: defineJsonRoute({ method: "get", path, parse: (raw) => settingsRouteInput(raw),
      handle: async ({ deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize,
        run: ({ principal }) => readGrant({ deps, policy, principal }) }) }) }),
    put: defineJsonRoute({ method: "put", path, parse: (raw) => settingsRouteInput(raw),
      handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize,
        run: ({ principal, authorize: auth }) => writeGrant({ deps, policy, principal, authorize: auth, body: input.body }) }, { write: { body: input.body } }) }) }),
  };
}
