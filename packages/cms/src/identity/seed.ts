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

/**
 * The built-in role the seeded owner user holds, and its authority. Named constants because two
 * call sites now depend on them agreeing exactly — the fresh seed below and `ensureOwnerRoleBinding`,
 * which repairs an interrupted one. Drift between the two would be a silent authority bug.
 *
 * REQ-04/REQ-09: the owner policy holds the wildcard `*`, not an enumerated list, so it
 * automatically covers permissions features register later.
 */
const OWNER_ROLE_NAME = "owner";
const OWNER_ROLE_PERMISSIONS: readonly string[] = ["*"];

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

/**
 * Why every step below is "find, then save only what is missing" rather than a straight insert.
 *
 * This function's writes are NOT transactional and its caller is not awaited by its hosts (one host
 * hands `seedIdentity`'s promise back as `RouteDeps.identityReady` and returns synchronously), so
 * a process that exits before the seed finishes — a fast-failing CLI command, a Ctrl-C, a crash —
 * leaves the workspace half-seeded. `seedIdentity`'s own early-return guard keys on the OWNER USER,
 * which is written last, so the next boot correctly decides the seed is unfinished and replays it.
 * A replay that blindly re-inserted would hit `UNIQUE(workspace_id, name)` on `roles`/`policies`
 * (crashing every subsequent boot, permanently), and would silently duplicate `role_policies` /
 * `policy_permissions` rows, which carry no unique index at all. So the replay must converge onto
 * the rows already there instead of re-creating them.
 *
 * What this deliberately does NOT do: adopt a role or policy an operator created themselves. A
 * same-named non-built-in row is a genuine conflict, not a partial seed, and silently promoting it
 * would hand its holders the built-in policy's permissions. Those cases throw.
 */

/** The built-in role for `name`, reusing a prior (possibly interrupted) seed's row if present. */
async function ensureBuiltinRole(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  name: string;
}): Promise<UUID> {
  const { deps, workspaceId, name } = required;
  const existing = await deps.repos.roles.findByName({ workspaceId, name });
  if (!existing) {
    const roleId = deps.idGen.newId();
    await deps.repos.roles.save({ id: roleId, workspaceId, name, isBuiltin: true });
    return roleId;
  }
  if (!existing.isBuiltin) {
    throw new Error(
      `seedIdentity: a non-built-in role named '${name}' already exists in workspace ${workspaceId}. ` +
        `Refusing to adopt it as the built-in '${name}' role — rename or remove it first.`
    );
  }
  return existing.id;
}

/** The built-in policy for `name`, reusing a prior (possibly interrupted) seed's row if present. */
async function ensureBuiltinPolicy(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  name: string;
}): Promise<UUID> {
  const { deps, workspaceId, name } = required;
  const policyName = `${name}-builtin-policy`;
  const existing = await deps.repos.policies.findByName({ workspaceId, name: policyName });
  if (!existing) {
    const policyId = deps.idGen.newId();
    await deps.repos.policies.save({
      id: policyId,
      workspaceId,
      name: policyName,
      description: `Built-in policy for the seeded '${name}' role.`,
      isBuiltin: true,
      isFrozen: false,
    });
    return policyId;
  }
  if (!existing.isBuiltin) {
    throw new Error(
      `seedIdentity: a non-built-in policy named '${policyName}' already exists in workspace ${workspaceId}. ` +
        `Refusing to adopt it as the built-in '${name}' policy — rename or remove it first.`
    );
  }
  return existing.id;
}

/**
 * Grant `permissions` to `policyId`, skipping any the policy already holds.
 *
 * Additive by design, and the reason a resumed seed still CONVERGES rather than merely staying
 * quiet: a built-in policy whose permission rows never landed (the interrupt fell between the
 * policy insert and this loop) gains them on the next boot. Compares only unscoped rows because
 * that is the only shape this seed writes — a `resourceType`-scoped row of the same name is a
 * different grant and must not satisfy an unscoped one.
 */
async function ensurePolicyPermissions(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  policyId: UUID;
  permissions: readonly string[];
}): Promise<void> {
  const { deps, workspaceId, policyId, permissions } = required;
  const existing = await deps.repos.policyPermissions.listByPolicyId({ workspaceId, policyId });
  const held = new Set(existing.filter((row) => row.resourceType === null).map((row) => row.permission));

  for (const permission of permissions) {
    if (held.has(permission)) continue;
    await deps.repos.policyPermissions.save({
      id: deps.idGen.newId(),
      workspaceId,
      policyId,
      permission,
      resourceType: null,
      constraintJson: null,
    });
  }
}

/** Builds one built-in role + its 1:1 policy + policy_permissions rows, converging on what exists. */
async function seedBuiltinRoleWithPolicy(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  name: string;
  permissions: readonly string[];
  nowIso: string;
}): Promise<{ roleId: UUID; policyId: UUID }> {
  const { deps, workspaceId, name, permissions, nowIso } = required;

  const roleId = await ensureBuiltinRole({ deps, workspaceId, name });
  const policyId = await ensureBuiltinPolicy({ deps, workspaceId, name });

  // `role_policies` has no unique index, so a replay would otherwise stack a second identical link.
  const links = await deps.repos.rolePolicies.listByRoleId({ workspaceId, roleId });
  if (!links.some((link) => link.policyId === policyId)) {
    await deps.repos.rolePolicies.save({ id: deps.idGen.newId(), workspaceId, roleId, policyId });
  }

  await ensurePolicyPermissions({ deps, workspaceId, policyId, permissions });

  void nowIso; // reserved for a future createdAt column on roles/policies
  return { roleId, policyId };
}

/**
 * Repair the one completion step `seedIdentity`'s owner-user guard cannot see.
 *
 * The guard keys on the owner USER, and the owner's `principal_roles` link is written after it. A
 * process that exits between those two adjacent writes leaves a workspace whose owner exists, can
 * still log in, and holds no role — and `resolveEffectivePermissions` (`authorize.ts`) starts from
 * `principal_roles` + `principal_policies`, so with neither present EVERY permission evaluates to
 * `no_grant`. Without this step the guard early-returns on the user it finds forever and the site
 * stays bricked for its owner, silently. Neither host-side reconciler closes it either: the host's
 * `migrateDeprecatedPermissionGrants` and `applyBuiltinRoleGrants` are handed policy and role repos
 * only, never `principalRoles`, so neither can write a principal->role link at all.
 *
 * Why the gate is "holds NO role" rather than "lacks the owner role". Those two conditions differ
 * on exactly one workspace shape, and it matters: an operator who moves the seeded owner principal
 * to a lesser role leaves it lacking the owner link on purpose. Repairing on that broader signal
 * would re-escalate the principal to wildcard authority on the next restart — a privilege
 * escalation shipped as a bug fix. A principal holding no role at all is never a deliberate state;
 * it is only ever the interrupted seed, so that is what this repairs.
 *
 * Converges rather than assuming: it goes through `seedBuiltinRoleWithPolicy`, so a workspace whose
 * owner ROLE or wildcard grant also never landed gains those here instead of being linked to a role
 * that grants nothing. `principal_roles` carries no unique index, hence the read-before-write.
 *
 * @complexity O(1) — a handful of point reads on a healthy boot (one `listByPrincipalId`, which
 * returns early), plus the fixed converge pass for the owner role only when the repair fires.
 */
async function ensureOwnerRoleBinding(required: {
  deps: SeedIdentityDeps;
  workspaceId: UUID;
  ownerPrincipalId: UUID;
  nowIso: string;
}): Promise<void> {
  const { deps, workspaceId, ownerPrincipalId, nowIso } = required;

  const heldRoles = await deps.repos.principalRoles.listByPrincipalId({
    workspaceId,
    principalId: ownerPrincipalId,
  });
  if (heldRoles.length > 0) return;

  const { roleId } = await seedBuiltinRoleWithPolicy({
    deps,
    workspaceId,
    name: OWNER_ROLE_NAME,
    permissions: OWNER_ROLE_PERMISSIONS,
    nowIso,
  });
  await deps.repos.principalRoles.save({
    id: deps.idGen.newId(),
    workspaceId,
    principalId: ownerPrincipalId,
    roleId,
  });
}

/**
 * Seed first-boot identity data.
 *
 * Idempotent in two distinct senses, and both are load-bearing:
 * - A seed that RAN TO COMPLETION is a no-op — the owner-username lookup below early-returns after
 *   a single confirming read (`ensureOwnerRoleBinding`) and writes nothing. (This path does not
 *   reconcile a built-in policy whose permission list has since grown; that is the host's job — see
 *   the host's `applyBuiltinRoleGrants` / `migrateDeprecatedPermissionGrants`, chained onto
 *   `identityReady`.)
 * - "Ran to completion" is judged on the owner user AND its role link, not the user alone. The link
 *   is the seed's last write, so the user is not on its own evidence the seed finished — see
 *   `ensureOwnerRoleBinding` for what an interrupt between those two writes costs.
 * - A seed that was INTERRUPTED is resumed, not replayed: every step converges onto the rows a
 *   previous attempt already wrote and fills in only what is missing. See the block comment above
 *   `ensureBuiltinRole` for why this function must survive being killed halfway.
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
    // The owner user alone is NOT proof the seed finished — its role link is written after it. See
    // `ensureOwnerRoleBinding`: on a healthy workspace this is one read and no write.
    await ensureOwnerRoleBinding({
      deps,
      workspaceId,
      ownerPrincipalId: existingOwnerUser.principalId,
      nowIso,
    });
    const existingSystem = (await deps.repos.principals.list({ workspaceId })).find(
      (row) => row.kind === "system" && row.id !== LEGACY_USER_LOCAL_PRINCIPAL_ID
    );
    return {
      ownerPrincipalId: existingOwnerUser.principalId,
      systemPrincipalId: existingSystem?.id ?? LEGACY_USER_LOCAL_PRINCIPAL_ID,
    };
  }

  // Reuse the system principal a prior interrupted seed may already have written: `principals` has
  // no unique index on kind, so a blind re-insert would leave TWO non-legacy system principals and
  // the early-return branch above picking between them by list order.
  const existingSystem = (await deps.repos.principals.list({ workspaceId })).find(
    (row) => row.kind === "system" && row.id !== LEGACY_USER_LOCAL_PRINCIPAL_ID
  );
  const systemPrincipalId = existingSystem?.id ?? deps.idGen.newId();
  if (!existingSystem) {
    await deps.repos.principals.save({
      id: systemPrincipalId,
      workspaceId,
      kind: "system",
      displayName: "System",
      status: "active",
      createdAt: nowIso,
    });
  }

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
    name: OWNER_ROLE_NAME,
    permissions: OWNER_ROLE_PERMISSIONS,
    nowIso,
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

  // Hashed BEFORE the owner principal row is written, not inline in the `users.save` below.
  // argon2id is deliberately slow, which made it by far the widest window in this un-awaited,
  // non-transactional sequence for a process to exit between the principal insert and the user
  // insert that gives it meaning — leaving an orphan `kind: "user"` principal behind on every
  // interrupted boot. Hashing first shrinks that window to a single adjacent await.
  const ownerPasswordHash = await deps.hasher.hash(ownerPassword);

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
    passwordHash: ownerPasswordHash,
  });
  // `principal_roles` carries no unique index either — same converge-don't-duplicate rule as the
  // `role_policies` link in `seedBuiltinRoleWithPolicy`.
  const ownerRoleLinks = await deps.repos.principalRoles.listByPrincipalId({
    workspaceId,
    principalId: ownerPrincipalId,
  });
  if (!ownerRoleLinks.some((link) => link.roleId === ownerRoleId)) {
    await deps.repos.principalRoles.save({
      id: deps.idGen.newId(),
      workspaceId,
      principalId: ownerPrincipalId,
      roleId: ownerRoleId,
    });
  }

  return { ownerPrincipalId, systemPrincipalId };
}
