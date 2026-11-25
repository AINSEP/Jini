import { NewsletterUnsubscribeTokenInvalidError } from "../../../newsletter/errors.js";
import { newsletterPage, queryToken, type NewsletterPublicRawRoute } from "./page.js";

/** What the host injects. */
export interface NewsletterUnsubscribeRouteDeps {
  /** Resolves once the newsletter ports are ready; awaited before the token is read. */
  ready(): Promise<void>;
  /** Processes the emailed unsubscribe token. Throws {@link NewsletterUnsubscribeTokenInvalidError} for a bad one. */
  unsubscribe(required: { readonly rawToken: string }): Promise<{ readonly outcome: "unsubscribed" | "already-unsubscribed" }>;
  /** Records an unexpected failure with the host's incident tracker and answers its error id. */
  reportFailure(required: { readonly error: unknown }): { readonly errorId: string };
}

const handle: NewsletterPublicRawRoute<NewsletterUnsubscribeRouteDeps>["handle"] = async ({ raw, deps }) => {
  await deps.ready();
  try {
    await deps.unsubscribe({ rawToken: queryToken({ query: raw.query }) });
    return newsletterPage({ status: 200, title: "You're unsubscribed", message: "You will no longer receive this newsletter. If this was a mistake, you can re-subscribe at any time." });
  } catch (err) {
    if (err instanceof NewsletterUnsubscribeTokenInvalidError) {
      return newsletterPage({ status: 400, title: "Unsubscribe link invalid", message: "This unsubscribe link is invalid or has expired." });
    }
    const { errorId } = deps.reportFailure({ error: err });
    return newsletterPage({ status: 500, title: "Unsubscription unavailable", message: `The site couldn’t complete unsubscription. Try the original action again and report this error ID if it keeps happening. Error ID: ${errorId}` });
  }
};

/**
 * `GET|POST /newsletter/unsubscribe?token=...` — `UNSUBSCRIBE` (api.spec.md §1a). Public,
 * cookie-less, no-login by design, same isolation lineage as `confirm.ts` — never reads
 * or sets a session cookie. `POST` is the RFC 8058 one-click path (the mail client itself, not this
 * server, is what stamps `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on the ORIGINAL
 * outbound email so it knows a bare POST here needs no further confirmation) — "GET with the same
 * token is equally valid" (api.spec.md §4), so both methods share one handler. Idempotent on a
 * repeat click of an already-processed token (REQ-15/EC-03): `processUnsubscribe` itself returns
 * `already-unsubscribed` rather than throwing, and this route renders the SAME success page either way.
 * @complexity O(1) beyond the token verification and one repository write.
 */
export const newsletterUnsubscribeGetRoute: NewsletterPublicRawRoute<NewsletterUnsubscribeRouteDeps> = {
  method: "get", path: "/newsletter/unsubscribe", bufferedReply: true, handle,
};

/** The RFC 8058 one-click `POST` of {@link newsletterUnsubscribeGetRoute}; the same handler. */
export const newsletterUnsubscribePostRoute: NewsletterPublicRawRoute<NewsletterUnsubscribeRouteDeps> = {
  method: "post", path: "/newsletter/unsubscribe", bufferedReply: true, handle,
};
