import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterList } from "../../http/newsletter.js";
import type { NewsletterArchiveListFn } from "./lists.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound `archiveList`. */
export interface NewsletterArchiveListRouteDeps extends NewsletterRouteBaseDeps {
  archiveList: NewsletterArchiveListFn;
}

/** `ARCHIVE_LIST` (api.spec.md §1) — `POST .../newsletter/lists/:id/archive`. `admin.newsletter.list.manage`-gated. Rejects the default list (`NEWSLETTER_DEFAULT_LIST_PROTECTED`). */
export const newsletterArchiveListRoute = defineJsonRoute<{ id: string }, { data: NewsletterList }, NewsletterArchiveListRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:id/archive",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.list.manage", entityType: "newsletter_list" });
    const { list } = await deps.archiveList({ workspaceId: deps.workspaceId, id: input.id });
    return ok({ value: toDataResponse({ data: list }) });
  } }),
});
