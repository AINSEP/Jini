/**
 * @file `AdminAuthPort` — the operator session lifecycle: sign in, sign out, and "who am I".
 *
 * Deliberately the smallest port in the set (3 methods) and deliberately separate from
 * `AdminIdentityPort`. The reference implementation's own API client keeps two different "user" shapes for exactly this
 * split: a minimal `{ id, username }` returned by `login`/`me`, and a much richer
 * `AdminIdentityUser` (principal id, status, role/policy ids, ...) returned by the identity CRUD
 * routes. That is not an oversight to unify — a session only ever needs to answer "who is this and
 * what can they see", while identity administration needs the full principal record. Collapsing
 * them would force every `me()` caller to depend on identity-administration fields it doesn't use.
 *
 * ## No error-code enum
 *
 * Expect a rejection from `login` for invalid credentials, and treat any other 4xx as an opaque
 * authentication failure — the exact `code` vocabulary belongs to the host. See
 * `../transport/errors.ts`'s header for why a shared code->message table is a regression.
 */

/** The minimal principal shape a session carries — see the file header for why this is not
 *  `AdminIdentityUser`. */
export interface AdminAuthUser {
  readonly id: string;
  readonly username: string;
}

export interface AdminAuthPort {
  /** Expect an authentication-class rejection (invalid credentials, disabled account) rather than
   *  a specific code — see the file header. */
  login(input: { username: string; password: string }): Promise<{ user: AdminAuthUser }>;
  logout(): Promise<{ ok: boolean }>;
  /**
   * The current session's principal, plus (when the host computes it) the permission strings
   * effective for that principal right now. `effectivePermissions` is an affordance list for
   * driving UI visibility — see `../permissions/rules.ts`'s `hasPermission`, which is intentionally
   * not an authorization boundary. A host that has not computed this yet may omit the field
   * entirely rather than send an empty array; callers should not treat "absent" and "empty" as the
   * same thing.
   */
  me(): Promise<{ user: AdminAuthUser; effectivePermissions?: readonly string[] }>;
}
