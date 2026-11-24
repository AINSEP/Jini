import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toDataResponse, type NewsletterList } from "../../http/newsletter.js";
import type { NewsletterSaveListFn } from "./lists.js";
import { admitNewsletterRequest, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound `saveList`. */
export interface NewsletterCreateListRouteDeps extends NewsletterRouteBaseDeps {
  saveList: NewsletterSaveListFn;
}

/**
 * `CREATE_LIST` (api.spec.md §1/§4) — `POST .../newsletter/lists`. `admin.newsletter.list.manage`-gated.
 * The two strings are checked in `parse`, so a bad body is a 400 before the permission check, as the
 * hand-written route answered it. Empty and whitespace-only values pass `parse` on purpose: refusing
 * them is `saveList`'s rule (`NEWSLETTER_VALIDATION_ERROR`), and answering it here too would change
 * the code the admin client reads.
 */
export const newsletterCreateListRoute = defineJsonRoute<{ name: string; slug: string }, { data: NewsletterList }, NewsletterCreateListRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists",
  parse: (raw) => {
    const body = (raw.body ?? {}) as { name?: unknown; slug?: unknown };
    const { name, slug } = body;
    if (typeof name !== "string" || typeof slug !== "string") {
      rejectRoute({ status: 400, error: "name and slug are required strings", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { name, slug } });
  },
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.list.manage", entityType: "newsletter_list" });
    const { list } = await deps.saveList({ workspaceId: deps.workspaceId, name: input.name, slug: input.slug });
    return ok({ value: toDataResponse({ data: list }) });
  } }),
}, { successStatus: 201 });
