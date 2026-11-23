import type { AdminUser } from "./models.js";
import type { MembersPort, RolesPort, UsersPort } from "@jini-ai/core/contracts/site/user-management-react";
export type { MembersPort, RolesPort, UsersPort } from "@jini-ai/core/contracts/site/user-management-react";

export interface LoginPort {
  login(credentials: { username: string; password: string }): Promise<{ user: AdminUser } | { mfaRequired: true; pendingToken: string }>;
  completeMfa?(input: { pendingToken: string; code: string }): Promise<{ user: AdminUser }>;
}


/** Compose once per host/workspace. Screens never choose an HTTP transport. */
export interface IdentityAdminPort extends LoginPort, UsersPort, RolesPort, MembersPort {}

/** The host owns event topics; subscribe binds only the current members scope. */
export interface IdentityRefreshPort {
  subscribe(required: { onRefresh: () => void }): () => void;
}
