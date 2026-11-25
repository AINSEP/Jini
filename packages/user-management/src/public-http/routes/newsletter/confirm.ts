import { NewsletterConfirmTokenInvalidError } from "../../../newsletter/errors.js";
import { newsletterPage, queryToken, type NewsletterPublicRawRoute } from "./page.js";

/** What the host injects. */
export interface NewsletterConfirmRouteDeps {
  /** Resolves once the newsletter ports are ready; awaited before the token is read. */
  ready(): Promise<void>;
  /** Consumes the emailed confirmation token for the host's workspace. Throws {@link NewsletterConfirmTokenInvalidError} for a bad one. */
  consume(required: { readonly rawToken: string }): Promise<{ readonly changed: boolean; readonly subscription: { readonly listId: string }; readonly eventId: string }>;
  /** Visitor analytics for a first (state-changing) confirmation; never alters the answer. */
  onSubscribed(required: { readonly listId: string; readonly eventId: string }): void;
  /** Records an unexpected failure with the host's incident tracker and answers its error id. */
  reportFailure(required: { readonly error: unknown }): { readonly errorId: string };
}

/**
 * `GET /newsletter/confirm?token=...` — `CONFIRM_SUBSCRIPTION` (api.spec.md §1a). Public,
 * cookie-less, no-login by design (§1a's "same cookie-less, no-admin-authority origin lineage as
 * ADR-020/025/027's isolation pattern"): this route family must NEVER read or set a session cookie,
 * and must never import `requireAdminSession`/`getAuthedPrincipal` (mirrors `routes/members/
 * sign-in.ts`'s ADR-PIPE-013 Enforcement note). Renders an HTML page (a human clicks this link),
 * not JSON.
 * @complexity O(1) beyond the token verification and one repository write.
 */
export const newsletterConfirmRoute: NewsletterPublicRawRoute<NewsletterConfirmRouteDeps> = {
  method: "get",
  path: "/newsletter/confirm",
  bufferedReply: true,
  handle: async ({ raw, deps }) => {
    await deps.ready();
    try {
      const result = await deps.consume({ rawToken: queryToken({ query: raw.query }) });
      if (result.changed) deps.onSubscribed({ listId: result.subscription.listId, eventId: result.eventId });
      return newsletterPage({ status: 200, title: "Subscription confirmed", message: "Your subscription is confirmed. You're all set." });
    } catch (err) {
      if (err instanceof NewsletterConfirmTokenInvalidError) {
        return newsletterPage({ status: 400, title: "Confirmation link invalid", message: "This confirmation link is invalid or has expired. Please request a new one." });
      }
      const { errorId } = deps.reportFailure({ error: err });
      return newsletterPage({ status: 500, title: "Subscription confirmation unavailable", message: `The site couldn’t complete subscription confirmation. Try the original action again and report this error ID if it keeps happening. Error ID: ${errorId}` });
    }
  },
};
