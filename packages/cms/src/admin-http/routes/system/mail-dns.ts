import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeMail, type MailRoutePrincipal } from "./mail-shared.js";

/**
 * @file The Email page's **Sender and DNS** section, over the same operations as the assistant's
 * `mail_dns_status` and `mail_dns_verify` tools:
 * - `GET  /api/admin/v1/workspaces/:workspaceId/system/mail-dns` (`deployments.read`): provider
 *   verdict, copyable rows and one unsaved record-by-record check.
 * - `POST /api/admin/v1/workspaces/:workspaceId/system/mail-dns/verify` (`deployments.publish`):
 *   **Check again**, saved as the sender domain's tracking state.
 * Both answer 200 with the host's mail DNS status DTO, whose `state` names why a table is absent (no
 * sender, no provider, verification unavailable for this provider, ...); only an unexpected fault is
 * a 500. Neither changes DNS.
 */

/** One mail DNS operation, already bound by the host to this workspace's DNS change deps; the DTO is answered unchanged. */
export type MailDnsOperation = () => Promise<object>;

/** The deps the status route reads: the unsaved read operation. */
export interface MailDnsStatusRouteDeps { readMailDnsStatus: MailDnsOperation }

/** The deps the verify route reads: the saving verify operation. */
export interface MailDnsVerifyRouteDeps { verifyMailDnsStatus: MailDnsOperation }

/** `GET .../system/mail-dns`: the unsaved status, gated by `deployments.read`. @complexity O(1) plus the injected operation. */
export const mailDnsStatusRoute = defineJsonRoute<Record<string, never>, object, MailDnsStatusRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/system/mail-dns",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMail({ authorize, permission: "deployments.read", entityType: "domain-dns" });
    return ok({ value: await deps.readMailDnsStatus() });
  },
});

/** `POST .../system/mail-dns/verify`: **Check again**, saved as tracking state, gated by `deployments.publish`. @complexity O(1) plus the injected operation. */
export const mailDnsVerifyRoute = defineJsonRoute<Record<string, never>, object, MailDnsVerifyRouteDeps, MailRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/system/mail-dns/verify",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMail({ authorize, permission: "deployments.publish", entityType: "domain-dns" });
    return ok({ value: await deps.verifyMailDnsStatus() });
  },
});
