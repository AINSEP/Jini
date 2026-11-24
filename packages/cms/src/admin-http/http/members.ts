/**
 * @file Admin-facing member response DTO (mirrors the admin posts DTO helper's pattern).
 *
 * Purpose:
 * Maps a stored member to what the admin API/UI may see.
 * Deliberately excludes anything session/token-shaped (ADR-030/ADR-021 trust
 * boundary: a member's `MemberSessionRecord.tokenHash` /
 * `MagicLinkTokenRecord.tokenHash` must never leave the server, and this
 * serializer is the chokepoint that guarantees it — those records aren't
 * even reachable from a `MemberRecord`, so there is no field to accidentally
 * forward). Also excludes `note` (operator-only annotation) and `fields`
 * (the namespaced ext bag, ADR-022 §2): neither is needed by the current
 * Members admin screen. Add them here deliberately if a future screen needs
 * them — never pass a `MemberRecord` through unfiltered.
 *
 * Architectural role:
 * HTTP-facing serialization only. The members library (and its `MemberRecord`) is not part of this
 * package yet, so the source shape is structural: the host's `MemberRecord` satisfies it, and the
 * host's registrar is where a drift between the two would fail to compile.
 */

/** Lifecycle states a stored member can be in — the members library's `MemberStatus`. */
export type AdminMemberStatus = "pending" | "active" | "disabled" | "trash";

/**
 * The member fields the serializer reads. Everything else a stored record carries (`note`, `fields`,
 * `credentialsRevokedAt`, …) is simply not named here, so it cannot be forwarded by accident.
 */
export interface AdminMemberSource {
  id: string;
  workspaceId: string;
  email: string;
  name?: string | undefined;
  status: AdminMemberStatus;
  emailVerifiedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Admin-facing shape of a member. */
export interface AdminMemberResponse {
  id: string;
  workspaceId: string;
  email: string;
  // `| undefined`: the serializer writes these keys even when empty (JSON drops them on the wire).
  name?: string | undefined;
  status: AdminMemberStatus;
  emailVerifiedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Envelope for a single-member response (GET/disable by id). */
export interface AdminMemberEnvelope {
  member: AdminMemberResponse;
}

/** Envelope for a member-list response: one keyset page, `nextCursor` null on the last page. */
export interface AdminMemberListResponse {
  members: AdminMemberResponse[];
  nextCursor: string | null;
}

/**
 * Serialize a stored member to the admin-facing `AdminMemberResponse`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminMemberResponse(member: AdminMemberSource): AdminMemberResponse {
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    email: member.email,
    name: member.name,
    status: member.status,
    emailVerifiedAt: member.emailVerifiedAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    version: member.version,
  };
}
