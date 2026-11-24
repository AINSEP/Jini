import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  rejectSubscriptionNotFound,
  type NewsletterIssueConfirmationTokenFn,
  type NewsletterSubscriberContactReader,
  type NewsletterSubscriptionReader,
} from "./subscriptions.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps, the subscription lookup, the subscriber directory and the host's bound `issueConfirmationToken`. */
export interface NewsletterResendConfirmationRouteDeps extends NewsletterRouteBaseDeps {
  newsletterSubscriptionRepo: NewsletterSubscriptionReader;
  newsletterSubscriberDirectory: NewsletterSubscriberContactReader;
  issueConfirmationToken: NewsletterIssueConfirmationTokenFn;
}

/**
 * `RESEND_CONFIRMATION` (api.spec.md §1/§5) — `POST .../newsletter/subscriptions/:id/
 * resend-confirmation`. `admin.newsletter.subscriber.manage`-gated. `issueConfirmationToken`
 * already invalidates the subscription's prior unconsumed token before minting a new one ("newest
 * wins", behavior.spec.md §2.1) — exactly `RESEND_CONFIRMATION`'s contract.
 * Response is the constant `{ delivered: true }` shape regardless of whether the underlying
 * Members contact resolves (OQ-01 anti-enumeration posture) — the one exception is a genuinely
 * unknown subscription id, which 404s (this route operates on an admin-known primary key, not a
 * caller-supplied email, so that 404 does not itself leak subscriber existence the way an
 * email-keyed public route's 404 would).
 */
export const newsletterResendConfirmationRoute = defineJsonRoute<{ id: string }, { delivered: true }, NewsletterResendConfirmationRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/subscriptions/:id/resend-confirmation",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" });
    const subscription = await deps.newsletterSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: input.id });
    if (!subscription) rejectSubscriptionNotFound({ id: input.id });
    const contact = await deps.newsletterSubscriberDirectory.getContact({ workspaceId: deps.workspaceId, subscriberId: subscription.subscriberId });
    if (contact) {
      await deps.issueConfirmationToken({ workspaceId: deps.workspaceId, subscriptionId: subscription.id, recipientEmail: contact.email });
    }
    return ok({ value: { delivered: true } });
  } }),
});
