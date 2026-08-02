/**
 * @file `AdminIdentityPort` — operator users, roles, and policies.
 *
 * The first port extracted, and the pattern-setter for the other eleven. Chosen first because it
 * is the largest coherent generic group in the corpus (17 of `api.ts`'s 134 methods), it carries
 * no CMS vocabulary, and the reference implementation is already CRUD-complete.
 *
 * ## Two things deliberately NOT in this port
 *
 * **Deleting a user.** The reference implementation has no route for it (its admin user routes cover create,
 * disable, enable, update, reset-password, and grant operations, nothing else), and disable is
 * the correct primitive for an audited system — a deleted principal orphans its audit trail.
 * Adding `deleteUser` here would put a method on the contract that the reference implementation
 * cannot satisfy.
 *
 * **An error-code enum.** Codes like `GRANT_EXCEEDS_ISSUER` and `OWNER_REQUIRED` are real and
 * load-bearing, but their operator-facing *wording* is host-specific — see `transport/errors.ts`
 * on why a shared code->message table is a regression. Panels read `AdminApiError.code` and map
 * it themselves.
 *
 * ## `members` is a different port
 *
 * Operator users (who administer the site) and members (end users who signed up) are distinct
 * populations with distinct lifecycles — the reference implementation keeps them in separate route groups and so does
 * this. `AdminMembersPort` is separate.
 */

/** An operator principal. */
export interface AdminIdentityUser {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly disabled?: boolean;
  readonly roleIds?: readonly string[];
  readonly policyIds?: readonly string[];
}

/** A named bundle of policies. */
export interface AdminRole {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly policyIds?: readonly string[];
}

/** A named bundle of permission strings. */
export interface AdminPolicy {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions?: readonly string[];
}

export interface AdminIdentityPort {
  listUsers(): Promise<readonly AdminIdentityUser[]>;
  createUser(input: { username: string; password: string; email?: string }): Promise<AdminIdentityUser>;
  updateUser(id: string, patch: { email?: string }): Promise<AdminIdentityUser>;
  /** Reversible; the audited alternative to deletion. See the file header. */
  disableUser(id: string): Promise<AdminIdentityUser>;
  enableUser(id: string): Promise<AdminIdentityUser>;
  resetUserPassword(id: string, input: { password: string }): Promise<{ ok: boolean }>;

  /**
   * Grants a role.
   *
   * Expect a `GRANT_EXCEEDS_ISSUER`-class rejection when the caller does not themselves hold
   * everything the role confers — privilege escalation via grant is the obvious attack here, and
   * the check is server-side. A panel must not pre-filter the role list as if that were the
   * boundary; it may hide options as an affordance, but the rejection is authoritative.
   */
  assignRole(userId: string, roleId: string): Promise<{ ok: boolean }>;
  attachPolicy(userId: string, policyId: string): Promise<{ ok: boolean }>;

  listRoles(): Promise<readonly AdminRole[]>;
  createRole(input: { name: string; description?: string }): Promise<AdminRole>;
  updateRole(id: string, patch: { name?: string; description?: string }): Promise<AdminRole>;
  /** Expect a conflict rejection when the role is still referenced by a principal. */
  deleteRole(id: string): Promise<{ ok: boolean }>;

  listPolicies(): Promise<readonly AdminPolicy[]>;
  createPolicy(input: { name: string; description?: string }): Promise<AdminPolicy>;
  updatePolicy(id: string, patch: { name?: string; description?: string }): Promise<AdminPolicy>;
  deletePolicy(id: string): Promise<{ ok: boolean }>;
  /** Adds or removes a single permission string on a policy. Granular by design: a whole-array
   *  replace makes two concurrent editors silently clobber each other. */
  writePolicyPermission(
    policyId: string,
    input: { permission: string; granted: boolean },
  ): Promise<AdminPolicy>;
}
