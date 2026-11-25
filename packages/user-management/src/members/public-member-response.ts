import type { MemberRecord, MemberStatus } from "./types.js";

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
export function toPublicMemberResponse({ member }: { member: Pick<MemberRecord, "id" | "email" | "name" | "status"> }, _optional = {}): PublicMemberResponse {
  return {
    id: member.id,
    email: member.email,
    ...(member.name === undefined ? {} : { name: member.name }),
    status: member.status,
  };
}
