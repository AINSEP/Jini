import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeMail, type MailRoutePrincipal } from "./mail-shared.js";

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/system/mail-status` — reports whether this site
 * can actually deliver email. The admin form editor greys out its notification settings while it
 * cannot ("no mail adapters are wired … it should be greyed out").
 *
 * Read-only and display-only: stored `notify_json` values and the forms write API are unaffected.
 * Gated on `admin.forms.manage` because the form editor is the consumer, so any principal who can
 * edit a form's notify settings can also see whether they will take effect.
 *
 * When the host supplies a provider-aware status, the body also carries `state`
 * (`ready|unconfigured|degraded`, which drives the admin's blocking banner), per-lane
 * provider/state, `warnings` and the installed providers (the safe configuration DTO plus
 * `checkedAt` and `lastError`). Never credentials. The status is cached briefly by the host;
 * `?refresh=1` rebuilds it. Provider actions live beside this route in `./mail-providers.ts`.
 */

/** The provider-aware status block the host builds; spread into the body unchanged. */
export type MailStatusBlock = Record<string, unknown>;

/** The host's cached status source; `refresh` rebuilds it instead of reusing the cache. */
export type MailStatusFn = (optional: { refresh: boolean }) => Promise<MailStatusBlock>;

/** The deps this route reads. */
export interface MailStatusRouteDeps {
  workspaceId: string;
  /**
   * Whether outbound mail really sends. The host owns this predicate (a console-only fallback is
   * "not available") and reads its live mailer on every call, because boot swaps the mailer in after
   * the routes are mounted.
   */
  isMailDeliveryAvailable: () => boolean;
  /** The provider-aware status; a host without a resolved mailer answers `{}`, leaving only availability. */
  mailStatus: MailStatusFn;
}

/** The body: `mailDeliveryAvailable` plus whatever the host's status block carries. */
export type MailStatusEnvelope = { mailDeliveryAvailable: boolean } & MailStatusBlock;

/**
 * GET the mail delivery status, gated by `admin.forms.manage` (the form editor is the consumer).
 * @complexity O(1) plus the injected status source.
 */
export const mailStatusRoute = defineJsonRoute<{ refresh: boolean }, MailStatusEnvelope, MailStatusRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/system/mail-status",
  // `?refresh=1` rebuilds the briefly cached status (provider checks) instead of reusing it.
  parse: (raw) => ok({ value: { refresh: raw.query.refresh === "1" || raw.query.refresh === "true" } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMail({ authorize, permission: "admin.forms.manage", entityType: "mail" });
    const status = await deps.mailStatus({ refresh: input.refresh });
    return ok({ value: { mailDeliveryAvailable: deps.isMailDeliveryAvailable(), ...status } });
  },
});
