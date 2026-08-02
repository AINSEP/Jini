/**
 * @file `AdminMembersPort` — end users who signed up on the site, as distinct from operators.
 *
 * Members are not principals in the `AdminIdentityPort` sense: they cannot sign in to this admin
 * surface, they have no roles or policies, and Tovu keeps them in a wholly separate route group.
 * See `identity.ts`'s file header for the fuller "why two ports" rationale.
 *
 * ## No `enableMember` on the contract
 *
 * Unlike `AdminIdentityPort`'s `disableUser`/`enableUser` pair, this port has disable only.
 * Tovu's `members/` route group (`src/server/routes/admin/members/`) has `list`, `get-by-id`,
 * `disable`, and `request-magic-link` — no re-enable route exists. Adding `enableMember` here would
 * put a method on the contract the reference implementation cannot satisfy. If a host needs it,
 * that is new route-level work, not a client-side gap.
 */

/** An end user who signed up on the site (not an operator — see the file header). */
export interface AdminMember {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly status: "pending" | "active" | "disabled";
  /** Set once the member has verified their email; absent until then. */
  readonly emailVerifiedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic-concurrency version. Not currently required by `disableMember` — Tovu's route
   *  takes only an id — but carried on the read shape for parity with the other versioned
   *  entities in this package, and in case a future disable route adds the guard. */
  readonly version: number;
}

export interface AdminMembersPort {
  listMembers(): Promise<readonly AdminMember[]>;
  getMember(id: string): Promise<AdminMember>;
  /** No `enableMember` counterpart — see the file header. */
  disableMember(id: string): Promise<AdminMember>;
  /**
   * Sends a passwordless sign-in link to the given address. Always resolves `{ delivered: true }`
   * regardless of whether the address belongs to a real member — an enumeration-safe response, not
   * a bug. `redirectPath` is where the link lands the member after it is followed; a host that
   * ignores it falls back to its own default landing location.
   */
  requestMemberMagicLink(
    input: { email: string },
    options?: { redirectPath?: string },
  ): Promise<{ delivered: true }>;
}
