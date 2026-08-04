import type { ClockPort, IdGeneratorPort, UUID } from "../core/ports.js";
import type { IdentityRepos, PasswordHasherPort } from "./ports.js";
import { normalizeUsername } from "./username.js";

/**
 * @file First-boot identity seed (REQ-09, state.spec `SEED_FIRST_BOOT`).
 *
 * Purpose:
 * Seeds, in one idempotent pass: a `system` principal; a disabled legacy
 * `user-local` principal (REQ-09/EC-09 — so any pre-existing `change_sets`
 * stamped `actorId='user-local'` satisfy the composite FK without rewriting
 * history); four built-in roles (`owner`/`admin`/`editor`/
 * `viewer`) each 1:1 with a built-in policy; and the initial `owner` user.
 *
 * How it relates to the project:
 * - Called once by each composition root (`server/app.ts` in-memory,
 *   `server/deps.ts` SQLite-content-with-in-memory-identity) before the
 *   server accepts requests. `RouteDeps.identityReady` is this call's
 *   promise — auth-adjacent middleware awaits it (see `middleware/dev-auth.ts`).
 *
 * Architectural role:
 * Seed data lives in one place so both composition roots stay identical
 * (mirrors `server/seed.ts`'s reasoning for workspace/post/presentation seed
 * data). Idempotent: re-seeding an already-seeded workspace is a no-op
 * (checked via the owner username).
 */

/** REQ-09: the literal id the legacy Article VI actor stamp resolves to. */
const LEGACY_USER_LOCAL_PRINCIPAL_ID = "user-local";

const BUILTIN_ADMIN_PERMISSIONS: readonly string[] = [
  "content.read",
  "content.write",
  "content.publish",
  "content.delete",
  "theme.set",
  // Editing a theme's source files is an admin capability, deliberately NOT in the editor set
  // below (which keeps theme.set): an editor may switch the site between validated themes, but
  // authoring template/CSS source is a build-time-shaped capability whose failure mode is a broken
  // theme, not a different-looking one.
  "theme.edit",
  "plugin.read",
  "plugin.enable",
  "plugin.disable",
  "changeset.read",
  "changeset.revert",
  "member.manage",
  "settings.write",
  "apikey.manage",
  // Migration clause (mirrors the admin.menus.*/admin.integrations.manage
  // precedent above): every freshly-seeded workspace's admin role gets the concrete media.* working
  // actions directly, so it never depends on migrateDeprecatedPermissionGrants(). The umbrella
  // "media.manage" is deliberately not included here (mirrors admin.menus.manage's exclusion
  // above). "media.write" is deliberately dropped from THIS seed list only — the string stays
  // registered (deprecated) in identity/permissions.ts.
  "media.read",
  "media.upload",
  "media.update",
  "media.delete",
  "media.delete.force",
  "media.download_original",
  "media.upload_svg",
  // Menus remediation migration clause: every freshly-seeded
  // workspace gets the 6 new admin.menus.* CRUD strings directly, so it never depends on
  // migrateDeprecatedPermissionGrants() for its own built-in role grants. The now-legacy
  // "navigation.manage" is deliberately dropped from THIS seed list only — the string itself
  // stays registered (deprecated) in identity/permissions.ts. migrateDeprecatedPermissionGrants()
  // now IS wired into live boot (identity/wiring.ts, chained right after seedIdentity resolves)
  // so any pre-existing policy still holding navigation.manage/integration.manage also gains
  // the new string(s) — this fresh-seed list just doesn't need to depend on that fan-out for its
  // own built-in role grants.
  "admin.menus.read",
  "admin.menus.create",
  "admin.menus.update",
  "admin.menus.delete",
  "admin.menus.delete.force",
  "admin.menus.assign",
  // Migration clause (mirrors the admin.menus.* precedent immediately
  // above): every freshly-seeded workspace gets admin.integrations.manage directly, so it never
  // depends on migrateDeprecatedPermissionGrants(). "integration.manage" is deliberately dropped
  // from THIS seed list only — the string stays registered (deprecated) in permissions.ts.
  "admin.integrations.manage",
  // Migration clause: every settings.write holder also
  // gets settings.definitions.manage, so the admin role isn't left
  // fail-closed-locked-out of definition-lifecycle operations it previously
  // reached through the coarse settings.write grant. No separate migration
  // script is needed pre-launch — this seed function is the sole source of
  // built-in role grants (no existing installation's data to migrate yet).
  "settings.definitions.manage",
  "settings.global.write",
  "settings.workspace.write",
  "settings.user.self.write",
  "settings.user.write",
  // Internal audit F2 remediation (2026-07-29): granted directly here so a freshly-seeded
  // workspace never depends on the `settings.user.write` -> `settings.user.read` fan-out in
  // permissions.ts (same "don't depend on migrateDeprecatedPermissionGrants for our own built-in
  // role grants" discipline as the admin.menus.*/admin.integrations.manage clauses above). The
  // fan-out exists for ALREADY-seeded installations, which this list cannot reach because
  // seedIdentity early-returns once an owner user exists.
  "settings.user.read",
  "settings.reset.global",
  "settings.reset.workspace",
  "settings.reset.user",
  "settings.read",
  "settings.read.raw",
  "settings.read.revisions",
  "settings.read.definitions",
  // Every freshly-seeded workspace's built-in admin role
  // gets the one SEO umbrella permission directly, mirroring the admin.menus.* precedent above.
  "admin.seo.manage",
  // The AI Assistant section's umbrella permission, granted directly here for the same reason
  // `admin.seo.manage` above is: a freshly-seeded workspace's built-in admin must be able to reach
  // the public assistant's master switch without depending on any deprecated-grant fan-out. Turning
  // the public assistant ON is still a deliberate act — the SETTING defaults to off
  // (`assistant/public-assistant-settings.ts`); this only grants the ability to flip it.
  "admin.assistant.manage",
  // Workspace Administration: admin gets workspace.manage
  // directly at seed — a distinct grant from settings.write, not owner-only (unlike user.manage/
  // role.manage below).
  "workspace.manage",
  // Owner-only per REQ-09: "user.manage", "role.manage" are deliberately absent.
];

const BUILTIN_EDITOR_PERMISSIONS: readonly string[] = [
  "content.read",
  "content.write",
  "content.publish",
  "content.delete",
  // Migration clause: editor gets the ordinary media working actions
  // (read/upload/update/trash) but, unlike admin above, NOT media.delete.force (destructive
  // hard-purge), media.download_original (mint-only access to sensitive originals), or
  // media.upload_svg (XSS-risk-gated capability) — mirrors the Forms admin.forms.manage vs
  // admin.forms.submissions.* PII-split precedent rather than granting editor
  // everything admin.write's single flat string previously implied. "media.write" is deliberately
  // dropped from THIS seed list only — the string stays registered (deprecated) in
  // identity/permissions.ts. Still a subset of admin's media.* set above (AC-12's owner ⊇ admin ⊇
  // editor subset property).
  "media.read",
  "media.upload",
  "media.update",
  "media.delete",
  "theme.set",
];

const BUILTIN_VIEWER_PERMISSIONS: readonly string[] = ["content.read", "changeset.read", "plugin.read"];

export interface SeedIdentityDeps {
  repos: IdentityRepos;
  hasher: PasswordHasherPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

export interface SeedIdentityInput {
  workspaceId: UUID;
  /** Defaults to `"admin"`. A username is not a secret, so a library default costs nothing here. */
  ownerUsername?: string | undefined;
  /**
   * Required, and deliberately without a default.
   *
   * This function mints the first credential that can administer a workspace. A library-supplied
   * fallback would mean every host that forgot to pass one shipped the *same* owner password, and
   * the omission would look like working code rather than a misconfiguration. Where the value comes
   * from — an environment variable, an operator prompt, a secret store, a generated string — is a
   * decision only the host can make, because only the host knows its deployment model. Making this
   * required turns "forgot to decide" into a compile error instead of a shared default credential.
   */
  ownerPassword: string;
  ownerEmail?: string | undefined;
}

export interface SeedIdentityResult {
  ownerPrincipalId: UUID;
  systemPrincipalId: UUID;
}

/** Builds one built-in role + its 1:1 policy + policy_permissions rows, and saves all three. */
async function seedBuiltinRoleWithPolicy(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  name: string;
  permissions: readonly string[];
  nowIso: string;
}): Promise<{ roleId: UUID; policyId: UUID }> {
  const { deps, workspaceId, name, permissions, nowIso } = required;
  const roleId = deps.idGen.newId();
  const policyId = deps.idGen.newId();

  await deps.repos.roles.save({ id: roleId, workspaceId, name, isBuiltin: true });
  await deps.repos.policies.save({
    id: policyId,
    workspaceId,
    name: `${name}-builtin-policy`,
    description: `Built-in policy for the seeded '${name}' role.`,
    isBuiltin: true,
    isFrozen: false,
  });
  await deps.repos.rolePolicies.save({ id: deps.idGen.newId(), workspaceId, roleId, policyId });

  for (const permission of permissions) {
    await deps.repos.policyPermissions.save({
      id: deps.idGen.newId(),
      workspaceId,
      policyId,
      permission,
      resourceType: null,
      constraintJson: null,
    });
  }

  void nowIso; // reserved for a future createdAt column on roles/policies
  return { roleId, policyId };
}

/**
 * Seed first-boot identity data (idempotent — a no-op if the owner username
 * already exists in the workspace).
 *
 * @complexity O(1) — fixed small number of inserts (4 roles/policies, ~2
 * dozen policy_permissions, 3 principals, 1 user, 1 role assignment).
 * @overallScore 100
 */
export async function seedIdentity(required: {
  deps: SeedIdentityDeps;
  input: SeedIdentityInput;
}): Promise<SeedIdentityResult> {
  const { deps, input } = required;
  const workspaceId = input.workspaceId;
  const ownerUsername = normalizeUsername(input.ownerUsername ?? "admin");
  const ownerPassword = input.ownerPassword;
  const nowIso = deps.clock.nowIso();

  const existingOwnerUser = await deps.repos.users.findByUsername({
    workspaceId,
    username: ownerUsername,
  });
  if (existingOwnerUser) {
    const existingSystem = (await deps.repos.principals.list({ workspaceId })).find(
      (row) => row.kind === "system" && row.id !== LEGACY_USER_LOCAL_PRINCIPAL_ID
    );
    return {
      ownerPrincipalId: existingOwnerUser.principalId,
      systemPrincipalId: existingSystem?.id ?? LEGACY_USER_LOCAL_PRINCIPAL_ID,
    };
  }

  const systemPrincipalId = deps.idGen.newId();
  await deps.repos.principals.save({
    id: systemPrincipalId,
    workspaceId,
    kind: "system",
    displayName: "System",
    status: "active",
    createdAt: nowIso,
  });

  // REQ-09/EC-09: disabled legacy actor so historical `actorId='user-local'`
  // change-sets resolve without rewriting history.
  await deps.repos.principals.save({
    id: LEGACY_USER_LOCAL_PRINCIPAL_ID,
    workspaceId,
    kind: "system",
    displayName: "Legacy actor (pre-identity)",
    status: "disabled",
    disabledAt: nowIso,
    createdAt: nowIso,
  });

  const { roleId: ownerRoleId } = await seedBuiltinRoleWithPolicy({
    deps,
    workspaceId,
    name: "owner",
    permissions: [],
    nowIso,
  });
  // REQ-04/REQ-09: the owner policy holds the wildcard `*`, not an enumerated
  // list, so it automatically covers permissions features register later.
  const ownerPolicy = (await deps.repos.policies.list({ workspaceId })).find(
    (row) => row.name === "owner-builtin-policy"
  );
  if (!ownerPolicy) throw new Error("seedIdentity: owner policy was not created");
  await deps.repos.policyPermissions.save({
    id: deps.idGen.newId(),
    workspaceId,
    policyId: ownerPolicy.id,
    permission: "*",
    resourceType: null,
    constraintJson: null,
  });

  await seedBuiltinRoleWithPolicy({
    deps,
    workspaceId,
    name: "admin",
    permissions: BUILTIN_ADMIN_PERMISSIONS,
    nowIso,
  });
  await seedBuiltinRoleWithPolicy({
    deps,
    workspaceId,
    name: "editor",
    permissions: BUILTIN_EDITOR_PERMISSIONS,
    nowIso,
  });
  await seedBuiltinRoleWithPolicy({
    deps,
    workspaceId,
    name: "viewer",
    permissions: BUILTIN_VIEWER_PERMISSIONS,
    nowIso,
  });

  const ownerPrincipalId = deps.idGen.newId();
  await deps.repos.principals.save({
    id: ownerPrincipalId,
    workspaceId,
    kind: "user",
    displayName: "Owner",
    status: "active",
    createdAt: nowIso,
  });
  await deps.repos.users.save({
    principalId: ownerPrincipalId,
    workspaceId,
    username: ownerUsername,
    email: input.ownerEmail,
    passwordHash: await deps.hasher.hash(ownerPassword),
  });
  await deps.repos.principalRoles.save({
    id: deps.idGen.newId(),
    workspaceId,
    principalId: ownerPrincipalId,
    roleId: ownerRoleId,
  });

  return { ownerPrincipalId, systemPrincipalId };
}
