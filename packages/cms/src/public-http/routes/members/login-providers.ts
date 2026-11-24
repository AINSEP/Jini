import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { refuseMemberAuthError, type MemberAuthRefusalFor } from "./shared.js";

/**
 * @file `GET /api/members/v1/workspaces/:workspaceId/login-providers` — safe provider metadata only;
 * configuration, pins and credentials never leave the server. Every failure is the host's fixed refusal.
 */

/** The deps this route reads; provider admission and the login refusal copy are the host's. */
export interface MemberLoginProvidersRouteDeps {
  workspaceId: string;
  /** Fresh admitted providers plus credential-card metadata, never secrets. */
  listProviders: (required: { workspaceId: string }) => Promise<readonly { readonly id: string; readonly label: string }[]>;
  /** The host's fixed login refusal; upstream errors may contain OAuth credentials, so nothing is echoed. */
  refusalFor: MemberAuthRefusalFor;
}

/** Public sign-in provider list.
 * @complexity O(p*c), p admitted providers, c credential metadata rows; bounded bundled catalog.
 */
export const memberLoginProvidersRoute: JsonRouteSpec<undefined, unknown, MemberLoginProvidersRouteDeps> & { readonly responseHeaders: Readonly<Record<string, string>> } = {
  ...defineJsonRoute<undefined, unknown, MemberLoginProvidersRouteDeps>({
    method: "get",
    path: "/api/members/v1/workspaces/:workspaceId/login-providers",
    parse: () => ok({ value: undefined }),
    handle: async ({ deps }) => {
      try {
        const providers = await deps.listProviders({ workspaceId: deps.workspaceId });
        return ok({ value: { providers: providers.map(provider => ({ id: provider.id, label: provider.label })) } });
      } catch (error) {
        return refuseMemberAuthError({ error, refusalFor: deps.refusalFor });
      }
    },
  }),
  responseHeaders: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
};
