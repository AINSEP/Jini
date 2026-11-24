import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import { refuseMemberAuthError, type MemberAuthRefusalFor, type PublicMemberRawRoute } from "./shared.js";

/**
 * @file `POST /api/members/v1/workspaces/:workspaceId/sign-out` — revoke only the member session; an
 * absent or already-revoked cookie still succeeds. Answers a bare `204` that clears the host's member
 * session cookie, so it is a raw route.
 */

/** The member sessions this route reads and revokes (the host's member-session repository). */
export interface MemberSignOutSessions {
  findByTokenHash(required: { workspaceId: string; tokenHash: string }): Promise<{ readonly id: string; readonly revokedAt?: string | null } | null>;
  revoke(required: { workspaceId: string; id: string; revokedAt: string }): Promise<void>;
}

/** The deps this route reads. Cookie name, attributes and error copy are the host's. */
export interface MemberSignOutRouteDeps {
  workspaceId: string;
  clock: Clock;
  sessions: MemberSignOutSessions;
  /** Hash a presented raw session token the way the host stored it. */
  hashToken: (required: { rawToken: string }) => string;
  /** The host's member-session cookie value from the `Cookie` header (`undefined` when absent). */
  readSessionToken: (required: { cookieHeader: string | undefined }) => string | undefined;
  /** The `Set-Cookie` value that clears the member session cookie with the attributes that set it. */
  clearedSessionCookie: () => string;
  refusalFor: MemberAuthRefusalFor;
}

/** Revoke the presented session when it is still live. O(1) I/O. */
async function revokePresentedSession(
  { raw, deps }: { raw: RouteInputContext; deps: MemberSignOutRouteDeps },
  _optional: Record<string, never> = {},
): Promise<void> {
  const rawToken = deps.readSessionToken({ cookieHeader: raw.headers?.cookie });
  const session = rawToken
    ? await deps.sessions.findByTokenHash({ workspaceId: deps.workspaceId, tokenHash: deps.hashToken({ rawToken }) })
    : null;
  if (session && !session.revokedAt) {
    await deps.sessions.revoke({ workspaceId: deps.workspaceId, id: session.id, revokedAt: nowIso({ clock: deps.clock }) });
  }
}

/** Public member sign-out. O(1) I/O. */
export const memberSignOutRoute: PublicMemberRawRoute<MemberSignOutRouteDeps> = {
  method: "post",
  path: "/api/members/v1/workspaces/:workspaceId/sign-out",
  readHeaders: ["cookie"],
  handle: async ({ raw, deps }) => {
    try {
      await revokePresentedSession({ raw, deps });
      return new Response(null, { status: 204, headers: { "set-cookie": deps.clearedSessionCookie() } });
    } catch (error) {
      return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
    }
  },
};
