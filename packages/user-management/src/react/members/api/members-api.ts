import type { AdminMember } from "@jini-ai/core/contracts/site/user-management-react";

/** What the host injects into {@link createMembersApi}. */
export interface MembersApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the members feature, bound to the host's injected collaborators.
 *  @example const membersApi = createMembersApi({ request, workspaceId }); */
export function createMembersApi({ request, workspaceId }: MembersApiDeps, _optional: Record<string, never> = {}) {
  return {
    listMembers: () =>
      request<{ members: AdminMember[] }>({ path: `/workspaces/${workspaceId}/members` }),
    getMember: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ member: AdminMember }>({ path: `/workspaces/${workspaceId}/members/${encodeURIComponent(id)}` }),
    disableMember: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ member: AdminMember }>({ path: `/workspaces/${workspaceId}/members/${encodeURIComponent(id)}/disable` }, { init: {
        method: "POST",
      } }),
    requestMemberMagicLink: ({ email }: { email: string }, options: { redirectPath?: string } = {}) =>
      request<{ delivered: true }>({ path: `/workspaces/${workspaceId}/members/request-magic-link` }, { init: {
        method: "POST",
        body: JSON.stringify({ email, redirectPath: options.redirectPath }),
      } }),
  };
}
