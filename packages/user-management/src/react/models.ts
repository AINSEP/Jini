/** Browser-facing administration DTOs; no transport or server imports. */
export interface AdminUser {
  id: string;
  username: string;
}

export type { AdminIdentityUser, AdminRole, AdminPolicy, AdminPolicyPermission, AdminMember } from "@jini-ai/core/contracts/site/user-management-react";
