import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import { rejectCampaignNotFound, type NewsletterCampaignFields, type NewsletterCampaignReader, type NewsletterSaveCampaignFn } from "./campaigns.js";
import { admitNewsletterRequest, newsletterActorId, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps, the existing-campaign read and the host's bound `saveCampaign`. */
export interface NewsletterUpdateCampaignRouteDeps extends NewsletterRouteBaseDeps {
  newsletterCampaignRepo: NewsletterCampaignReader;
  saveCampaign: NewsletterSaveCampaignFn;
}

/** This route's six patchable string fields, in the one order used for both validation and merge. */
const CAMPAIGN_STRING_FIELD_NAMES = ["subject", "preheader", "fromName", "fromEmail", "replyTo", "listId"] as const;

/**
 * Checks that each of `CAMPAIGN_STRING_FIELD_NAMES` is a string when present. Returns the first
 * violation's message, or `null`.
 *
 * @complexity O(1) — iterates a fixed 6-entry field list.
 */
function findInvalidStringField(body: Record<string, unknown>): string | null {
  for (const name of CAMPAIGN_STRING_FIELD_NAMES) {
    const value = body[name];
    if (value !== undefined && typeof value !== "string") {
      return `${name} must be a string when provided`;
    }
  }
  return null;
}

/**
 * Checks that `bodyJson` (persisted in editorial revision JSON) is a non-null object when present.
 *
 * @complexity O(1).
 */
function validateBodyJsonField(body: Record<string, unknown>): string | null {
  if (body.bodyJson !== undefined && (typeof body.bodyJson !== "object" || body.bodyJson === null || Array.isArray(body.bodyJson))) {
    return "bodyJson must be an object when provided";
  }
  return null;
}

/**
 * Checks that `expectedVersion` (EC-06) is a non-negative integer when present.
 * `expectedVersion`'s absence specifically means "skip the optimistic-concurrency check" per
 * `saveCampaign`'s own contract.
 *
 * @complexity O(1).
 */
function validateExpectedVersionField(body: Record<string, unknown>): string | null {
  if (
    body.expectedVersion !== undefined &&
    (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0)
  ) {
    return "expectedVersion must be a non-negative integer when provided";
  }
  return null;
}

/**
 * Validates the PATCH body by running the field validators in order and returning the first
 * violation's message, or `null`. Every field is optional — this is a partial update.
 *
 * @complexity O(1) — delegates to three fixed-cost validators.
 */
function validateCampaignPatchBody(body: Record<string, unknown>): string | null {
  return findInvalidStringField(body) ?? validateBodyJsonField(body) ?? validateExpectedVersionField(body);
}

/**
 * Merges the body's provided string fields over the existing campaign's current values.
 * `saveCampaign` (Stage 2) has no partial-update mode of its own — see the route doc — so this
 * route-layer merge is what makes an omitted field a no-op instead of an overwrite with `undefined`.
 *
 * @complexity O(1).
 */
function mergeCampaignPatchFields(body: Record<string, unknown>, existing: NewsletterCampaign): NewsletterCampaignFields {
  return {
    subject: typeof body.subject === "string" ? body.subject : existing.subject,
    bodyJson: body.bodyJson === undefined ? existing.bodyJson : body.bodyJson as Record<string, unknown>,
    preheader: typeof body.preheader === "string" ? body.preheader : existing.preheader,
    fromName: typeof body.fromName === "string" ? body.fromName : existing.fromName,
    fromEmail: typeof body.fromEmail === "string" ? body.fromEmail : existing.fromEmail,
    replyTo: typeof body.replyTo === "string" ? body.replyTo : existing.replyTo,
    listId: typeof body.listId === "string" ? body.listId : existing.listId,
  };
}

/**
 * `UPDATE_CAMPAIGN` (api.spec.md §1/§4) — `PATCH .../newsletter/campaigns/:id`. Every body field is
 * optional (a true partial update): `campaign-write-service.ts`'s `saveCampaign` (Stage 2) has no
 * partial-update mode of its own (its `input.fields` are all non-optional in the exported
 * function's type — it always overwrites, never merges), so this route reads the existing campaign
 * first and merges any omitted field from its current value before calling `saveCampaign` — a
 * route-layer responsibility, not a change to the write chokepoint's own logic.
 *
 * `expectedVersion` (optional number, EC-06) is forwarded to `saveCampaign` as-is — never merged
 * into `fields` like the six string fields above, since it is a precondition on the write, not a
 * value being written. `saveCampaign`'s own `input.expectedVersion !== undefined` guard is what
 * makes omitting it legal (a caller that never sends it is unaffected); this route only needs to
 * validate the shape (a non-negative integer, same 400 `VALIDATION_ERROR` shape as the other
 * fields) and pass through, since the actual conflict check and `NEWSLETTER_CONFLICT` (409) already
 * live at the chokepoint (`campaign-write-service.ts`) and are already mapped to a response by
 * the host's injected error table.
 *
 * DISCLOSED GAP (found while wiring, not fixed): api.spec.md describes `UPDATE_CAMPAIGN` as valid
 * "while `draft`/`scheduled`", but `saveCampaign`'s actual guard (`campaign-write-service.ts`) only
 * permits `status === 'draft'` — a `scheduled` campaign is rejected with
 * `NEWSLETTER_CAMPAIGN_NOT_EDITABLE` even though the spec's own prose says it should be editable.
 * This route wires to the existing (already "certified"/tested) Stage 2 guard as-is per this
 * dispatch's explicit boundary against changing Stage 1-4 domain logic; flagged rather than
 * silently patched.
 *
 * The envelope-only table previously caused bodyJson to be discarded here too. The document now
 * travels through the write chokepoint into revision JSON; an omitted document remains unchanged.
 */
export const newsletterUpdateCampaignRoute = defineJsonRoute<{ id: string; body: Record<string, unknown> }, { data: NewsletterCampaign }, NewsletterUpdateCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id",
  // Validated before the permission check (a 400 wins over a 403), as the hand-written route did.
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    const validationError = validateCampaignPatchBody(body);
    if (validationError) rejectRoute({ status: 400, error: validationError, code: "VALIDATION_ERROR" });
    return ok({ value: { id: newsletterIdParam(raw.params), body } });
  },
  handle: ({ input, deps, context, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" });
    const existing = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: input.id });
    if (!existing) rejectCampaignNotFound({ id: input.id });
    const { campaign } = await deps.saveCampaign({
      workspaceId: deps.workspaceId,
      id: input.id,
      actorId: newsletterActorId({ context }),
      expectedVersion: typeof input.body.expectedVersion === "number" ? input.body.expectedVersion : undefined,
      fields: mergeCampaignPatchFields(input.body, existing),
    });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
