import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';

/**
 * @file Admin Deployment panel → Overview tab backend.
 *
 * `GET /api/admin/v1/workspaces/:workspaceId/system/deployment-overview` — a read-only snapshot of
 * how THIS instance is currently running, for the self-hosted-developer audience the Deployment
 * panel targets. Every field is a direct read of a value the host process already computed at boot
 * or can compute for free; nothing is measured, inferred, or fabricated.
 *
 * Mirrors `module-status.ts`'s shape (workspace 404 → `system.read` authorize → 403 on denial, the
 * 404 and 403 being the host ports'), reusing the same permission — this is one more system-status
 * read, not a new kind of capability. `entityType: "deployment-status"` is a route-specific
 * descriptive string rather than a shared literal across unrelated resources.
 *
 * The spec owns the one rule that needs the database — whether the seeded owner is still on the
 * publicly-documented default password — and the host owns every process-state read (runtime mode,
 * env presence, the site-key resolution, storage paths), injected as `buildSnapshot`.
 */

/** One required-for-production env var's presence, never its value. */
export interface DeploymentEnvVarStatus {
  name: string;
  set: boolean;
  /** site key row only: where the keyring's material came from. */
  source?: string;
  /** site key row only, present iff material was found but the keyring would reject it. */
  invalid?: true;
}

/** The Overview tab's wire body; the host builds every field but `defaultOwnerPasswordUnsafe`'s input. */
export interface DeploymentOverviewSnapshot {
  /** The host's own two-value runtime mode, echoed in its exact vocabulary rather than translated. */
  mode: 'production' | 'local';
  /** In production a failing readiness gate exits before listening, so reaching this route proves it passed;
   *  `applicable: false` in local mode is the honest "this check does not run here" state, not a hidden pass. */
  productionReadinessGate: { applicable: boolean; passed: boolean };
  /** Whether the owner's STORED hash still verifies against the default password (see {@link isOwnerOnDefaultPassword}). */
  defaultOwnerPasswordUnsafe: boolean;
  /** A negative signal only: "not known-failed" can also mean "never spawned", never "confirmed alive". */
  daemonKnownFailed: boolean;
  dbPath: string;
  uploadsDir: string;
  /** Presence only, per required env var — never a value. */
  envVars: DeploymentEnvVarStatus[];
}

/** The owner lookup this route makes (structurally the user-management repo's `findByPrincipalId`). */
export type DeploymentOwnerLookupFn = (required: { workspaceId: string; principalId: string }) => Promise<{ passwordHash: string } | null>;
/** The host's live process-state read, given the one field this spec computed. */
export type DeploymentOverviewSnapshotFn = (required: { defaultOwnerPasswordUnsafe: boolean }) => DeploymentOverviewSnapshot;

/** The deps this route reads. */
export interface DeploymentOverviewRouteDeps {
  workspaceId: string;
  identityReady: Promise<unknown>;
  ownerPrincipalId: Promise<string>;
  userRepo: { findByPrincipalId: DeploymentOwnerLookupFn };
  passwordHasher: { verify: (required: { hash: string; password: string }) => Promise<boolean> };
  /** The host's publicly-documented seeded-owner password (host product constant). */
  defaultOwnerPassword: string;
  buildSnapshot: DeploymentOverviewSnapshotFn;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface DeploymentOverviewPrincipal { id: string }

/**
 * Whether the seeded owner's stored password still verifies against the default.
 *
 * Read from the database because the env var only says what a FIRST boot would seed: seeding never
 * rotates an existing owner, so the env var and the stored credential drift apart the moment either
 * changes (a host that spawns with a random password still reports a site created earlier on the
 * default; an owner who changed their password in the admin UI with the env var unset is no longer
 * reported as "still the default" forever).
 *
 * @returns `false` when there is no owner user row to check (nothing can sign in with the default).
 * @complexity O(1) — one user lookup and one password verify (tens of ms, by design of the hash).
 */
async function isOwnerOnDefaultPassword(deps: DeploymentOverviewRouteDeps, _optional: Record<string, never> = {}): Promise<boolean> {
  await deps.identityReady;
  const principalId = await deps.ownerPrincipalId;
  const owner = await deps.userRepo.findByPrincipalId({ workspaceId: deps.workspaceId, principalId });
  if (!owner) return false;
  return deps.passwordHasher.verify({ hash: owner.passwordHash, password: '' });
}

/** `GET .../system/deployment-overview`: the live deployment snapshot.
 * @complexity O(1) plus the injected reads.
 */
export const deploymentOverviewRoute = defineJsonRoute<Record<string, never>, DeploymentOverviewSnapshot, DeploymentOverviewRouteDeps, DeploymentOverviewPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/deployment-overview',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorize(authorize)({ permission: 'system.read', entityType: 'deployment-status' });
    return ok({ value: deps.buildSnapshot({ defaultOwnerPasswordUnsafe: await isOwnerOnDefaultPassword(deps) }) });
  },
});

/** The handler's own authorizer; a spec mounted without one is a wiring bug and fails closed. */
function requireAuthorize(authorize: JsonRouteAuthorize | undefined, _optional: Record<string, never> = {}): JsonRouteAuthorize {
  if (!authorize) throw new Error('deployment-overview route has no authorizer');
  return authorize;
}
