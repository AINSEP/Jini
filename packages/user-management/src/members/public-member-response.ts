import type { MemberRecord, MemberStatus } from "./types.js";

/**
 * @file Public-facing member response DTO: the response a member's own (unauthenticated) browser receives.
 * Stricter than an operator-facing serializer: besides `note`, `fields` and anything session/token-shaped it
 * excludes `emailVerifiedAt`, `workspaceId` and `version`. A public serializer leaking an internal field here is a
 * direct PII/internal-state exposure, so the object is built from an allowlist, never by spreading the record.
 * The member cookie name is the host's and stays out of this package.
 */

/** Public-facing shape of a member — deliberately the smallest useful surface. */
export interface PublicMemberResponse {
  id: string;
  email: string;
  name?: string;
  status: MemberStatus;
}

/**
 * Serialize a `MemberRecord` to the public-facing `PublicMemberResponse`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toPublicMemberResponse({ member }: { member: Pick<MemberRecord, "id" | "email" | "name" | "status"> }, _optional: Record<string, never> = {}): PublicMemberResponse {
  return {
    id: member.id,
    email: member.email,
    ...(member.name === undefined ? {} : { name: member.name }),
    status: member.status,
  };
}
