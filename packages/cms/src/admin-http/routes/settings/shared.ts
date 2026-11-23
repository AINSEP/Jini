import { ok, type JsonRouteAuthorize, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { SettingScope, SettingsRepoPort, UserLayerReadTarget } from "@jini-ai/core/settings";

import { touchesProtectedNamespaces } from "./protected-namespaces.js";

/**
 * @file Shared guards and error mapping for the `settings` admin route specs.
 *
 * Every settings route used to mount through one host helper that awaited the settings ledger's
 * readiness, read the session, fenced protected namespaces and mapped each route's own domain
 * error classes onto `{ error, code }`. The specs keep that order here (readiness → principal →
 * fence → route body), turn each route's `catch` ladder into a mapping table, and leave the
 * unmapped failure to the host's error port (its redacted 500).
 *
 * Field validation stays inside `handle`, not `parse`: reads authorize before they validate, and
 * writes run the protected-namespace fence before validating — `parse` would answer 400 first.
 */

/** The principal fields these routes read: only the id (the caller / actor). */
export interface SettingsRoutePrincipal { id: string }

/** What `parse` hands every settings route: the raw query and body, validated in `handle`. */
export interface SettingsRouteInput { query: Record<string, unknown>; body: unknown }

/** Pass the query and body through unchanged; see the file header for why no field is checked here.
 * @complexity O(1). */
export function settingsRouteInput(raw: RouteInputContext, _optional: Record<string, never> = {}) {
  return ok({ value: { query: raw.query, body: raw.body } as SettingsRouteInput });
}

/** The three scopes a setting value lives in. */
export const SETTING_SCOPES: readonly SettingScope[] = ["global", "workspace", "user"];

/** The deps every settings route reads: its workspace and the ledger's readiness promise. */
export interface SettingsRouteBaseDeps {
  workspaceId: string;
  /** Awaited before anything else touches the ledger; a rejection is the host's fixed 500. */
  settingsReady: PromiseLike<unknown>;
}

/**
 * Namespaces a generic write may not reach (host policy, injected): `protected` answers 403 (an
 * owner-only grant has its own endpoint); `codeOwned` answers 400 for a definition batch only (a
 * code-owned default must not be rewritten into an implicit enable).
 */
export interface SettingsWriteFence {
  protected: { namespaces: readonly string[]; error: string };
  codeOwned: { namespaces: readonly string[]; code: string; error: string };
}

/** The extra deps a write route reads: the ledger to resolve aliases through and the fence policy. */
export interface SettingsWriteRouteBaseDeps extends SettingsRouteBaseDeps {
  settingsRepo: SettingsRepoPort;
  writeFence: SettingsWriteFence;
}

/** Reads another principal's user layer only after a second, non-throwing grant check (host-bound). */
export type SettingsReadTargetFn = (required: { requestedPrincipalId: string | undefined; callerPrincipalId: string }) => Promise<UserLayerReadTarget>;

/** One `catch` rung: which thrown error class maps to which HTTP status/code pair. */
export interface SettingsErrorRung {
  readonly matches: (error: unknown) => boolean;
  readonly status: number;
  readonly code: string;
}

/**
 * Refuses with the first matching rung's status/code and the error's own message (the body the
 * hand-written ladder wrote); anything unmapped is rethrown so the host answers its redacted 500.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectSettingsError({ err, mappings }: { err: unknown; mappings: readonly SettingsErrorRung[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches(err));
  if (!mapping) throw err;
  rejectRoute({ status: mapping.status, error: err instanceof Error ? err.message : String(err), code: mapping.code });
}

/**
 * Code-owned visitor defaults must not be rewritten into an implicit enable through the generic
 * definition batch, and no generic mutation may reach an owner-only namespace. Both checks run
 * before ANY item writes (definition batches are resolved whole).
 * @complexity As `touchesProtectedNamespaces`, at most twice. No writes.
 */
async function fenceProtectedWrite({ deps, body }: { deps: SettingsWriteRouteBaseDeps; body: unknown }, _optional: Record<string, never> = {}): Promise<void> {
  const { settingsRepo: repo, workspaceId, writeFence } = deps;
  if (Array.isArray((body as { definitions?: unknown } | null)?.definitions)
    && await touchesProtectedNamespaces({ body, repo, workspaceId, namespaces: writeFence.codeOwned.namespaces })) {
    rejectRoute({ status: 400, code: writeFence.codeOwned.code, error: writeFence.codeOwned.error });
  }
  if (await touchesProtectedNamespaces({ body, repo, workspaceId, namespaces: writeFence.protected.namespaces })) {
    rejectRoute({ status: 403, code: "FORBIDDEN", error: writeFence.protected.error });
  }
}

/** What a settings route body receives once readiness, the session and the fence have passed. */
export interface SettingsRouteEntry { principal: SettingsRoutePrincipal; authorize: JsonRouteAuthorize }

/**
 * Runs one settings route body in the old order: readiness, then the principal (a missing session
 * is the host's fixed 500, before the fence), then the write fence, then the body; mapped domain
 * errors become refusals and everything else is rethrown. A mount without an authorizer is a
 * wiring bug, so it fails closed.
 *
 * Field parsing remains in each handler: reads authorize first, while writes validate both fields
 * and body workspace first. Domain services retain their non-bypassable inner authorization.
 * Unknown failures keep the host's fixed 500 envelope rather than disclosing exception messages.
 * @complexity O(1) plus readiness, the fence (writes only) and the route body.
 */
export async function runSettingsRoute<Output>(
  required: {
    deps: SettingsRouteBaseDeps | SettingsWriteRouteBaseDeps; context: SettingsRoutePrincipal | undefined;
    authorize: JsonRouteAuthorize | undefined; run: (entry: SettingsRouteEntry) => Promise<Output>;
  },
  optional: { write?: { body: unknown }; mappings?: readonly SettingsErrorRung[] } = {},
): Promise<Output> {
  const { deps, context, authorize } = required;
  try {
    await deps.settingsReady;
    if (!context) throw new Error("settings route has no authenticated principal");
    if (optional.write) await fenceProtectedWrite({ deps: deps as SettingsWriteRouteBaseDeps, body: optional.write.body });
    if (!authorize) throw new Error("settings route has no authorizer");
    return await required.run({ principal: context, authorize });
  } catch (err) {
    return rejectSettingsError({ err, mappings: optional.mappings ?? [] });
  }
}

/**
 * The 403 a read answers when the caller may not see another principal's user layer.
 * @complexity O(1). */
export function rejectCrossPrincipalRead(
  { principalId, reason, permission }: { principalId: string; reason: string; permission: string },
  _optional: Record<string, never> = {},
): never {
  rejectRoute({
    status: 403,
    error: `principal '${principalId}' is not authorized to read another principal's user-layer value (${reason})`,
    code: "FORBIDDEN",
    details: { permission, reason },
  });
}
