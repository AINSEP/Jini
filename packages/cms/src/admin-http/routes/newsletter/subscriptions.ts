import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { NewsletterSubscription } from "../../http/newsletter.js";

/**
 * @file The subscription collaborators the subscription route specs share. Each function is the
 * host's own `subscriptions.ts` / `confirmation.ts` function with its deps already bound, so a spec
 * only supplies the request's input — the same input object the hand-written route passed.
 */

/** Where a subscription came from; `import` is only ever set by the import route itself. */
export type NewsletterSubscriptionSource = "admin" | "import" | "api";

/** A subscription write's result: the subscription as it now stands. */
export interface NewsletterSubscriptionResult { subscription: NewsletterSubscription }

/** The host's `saveSubscription`: it resolves the subscriber against Members and mints the confirmation. */
export type NewsletterSaveSubscriptionFn = (
  required: { workspaceId: string; listId: string; subscriberId: string; source: NewsletterSubscriptionSource },
  optional?: Record<string, never>,
) => Promise<NewsletterSubscriptionResult>;

/** The host's `importSubscriptions` outcome: the rows that were created and the rows (by index) that failed. */
export interface NewsletterImportOutcome { created: readonly unknown[]; failed: readonly unknown[] }

/** The host's `importSubscriptions`: each row takes the same path as {@link NewsletterSaveSubscriptionFn}. */
export type NewsletterImportSubscriptionsFn = (
  required: { workspaceId: string; listId: string; subscribers: readonly { subscriberId: string; source: "import" }[] },
  optional?: Record<string, never>,
) => Promise<NewsletterImportOutcome>;

/** The host's `unsubscribeSubscription`: a soft state transition that answers the `unsubscribed` row. */
export type NewsletterUnsubscribeSubscriptionFn = (
  required: { workspaceId: string; id: string },
  optional?: Record<string, never>,
) => Promise<NewsletterSubscriptionResult>;

/** The host's `issueConfirmationToken`: supersedes the prior unconsumed token, mints a new one and mails it. */
export type NewsletterIssueConfirmationTokenFn = (
  required: { workspaceId: string; subscriptionId: string; recipientEmail: string },
  optional?: Record<string, never>,
) => Promise<unknown>;

/** The one repo read the remove and resend routes make. */
export interface NewsletterSubscriptionReader {
  findById(required: { workspaceId: string; id: string }): Promise<NewsletterSubscription | null>;
}

/** The host's subscriber directory, read for one subscriber's mailing address. */
export interface NewsletterSubscriberContactReader {
  getContact(required: { workspaceId: string; subscriberId: string }): Promise<{ email: string } | null>;
}

/**
 * The host's `NewsletterSubscriptionNotFoundError` answer, raised directly: the route itself decided
 * the subscription is missing, so there is no host error to map. Same status, code and message as
 * the host's error table writes for that class.
 * @complexity O(1).
 */
export function rejectSubscriptionNotFound({ id }: { id: string }, _optional: Record<string, never> = {}): never {
  rejectRoute({ status: 404, error: `subscription ${id} was not found`, code: "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" });
}
