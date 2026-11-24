import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { refuseMemberAuthError, type MemberAuthRefusalFor } from "./shared.js";

/**
 * @file `GET /api/members/v1/workspaces/:workspaceId/me` — never cache identity; the host's resolver
 * validates the session, then the member row enforces current status.
 */

/** One linked sign-in identity as the member sees it: labels and ids only. */
export interface PublicMemberIdentity { readonly providerId: string; readonly label: string }

/** The deps this route reads; the session resolver, member rows and their public shape are the host's. */
export interface MemberMeRouteDeps<Member extends { readonly id: string; readonly status: string }> {
  workspaceId: string;
  /** The host's member-session cookie value from the `Cookie` header (throws on an ambiguous header). */
  readSessionToken: (required: { cookieHeader: string | undefined }) => string | undefined;
  /** The member id of the live session the token names, or `null`. */
  resolveMemberId: (required: { sessionToken: string | undefined }) => Promise<string | null>;
  findMember: (required: { id: string }) => Promise<Member | null>;
  toPublicMember: (required: { member: Member }) => unknown;
  /** The member's linked identities, labelled (subjects, issuer and timestamps stay internal). */
  listPublicIdentities: (required: { memberId: string }) => Promise<readonly PublicMemberIdentity[]>;
  refusalFor: MemberAuthRefusalFor;
}

type AnyMember = { readonly id: string; readonly status: string };

/** Public member identity read. O(p) member providers. */
export const memberMeRoute: JsonRouteSpec<{ cookieHeader: string | undefined }, unknown, MemberMeRouteDeps<AnyMember>> & {
  readonly readHeaders: readonly string[]; readonly responseHeaders: Readonly<Record<string, string>>;
} = {
  ...defineJsonRoute<{ cookieHeader: string | undefined }, unknown, MemberMeRouteDeps<AnyMember>>({
    method: "get",
    path: "/api/members/v1/workspaces/:workspaceId/me",
    parse: (raw) => ok({ value: { cookieHeader: raw.headers?.cookie } }),
    handle: async ({ input, deps }) => {
      try {
        const memberId = await deps.resolveMemberId({ sessionToken: deps.readSessionToken({ cookieHeader: input.cookieHeader }) });
        const member = memberId ? await deps.findMember({ id: memberId }) : null;
        const visible = member && (member.status === "active" || member.status === "pending") ? member : null;
        const identities = visible ? await deps.listPublicIdentities({ memberId: visible.id }) : [];
        return ok({ value: { member: visible ? deps.toPublicMember({ member: visible }) : null, identities } });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  readHeaders: ["cookie"],
  responseHeaders: { "Cache-Control": "no-store" },
};
