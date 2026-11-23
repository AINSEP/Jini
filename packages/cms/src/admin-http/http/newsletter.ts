/**
 * @file Response DTOs + the host error-mapper port for the admin `newsletter` HTTP surface
 * (SPEC-011, ADR-PIPE-011): HTTP-facing serialization only — no newsletter business logic lives
 * here, and none lives in the engine at all. The newsletter domain (services, records, typed
 * errors) is the host's, so the specs receive its collaborators as injected functions and read
 * records through the minimal structural types below.
 *
 * Unlike `widgets`, none of Newsletter's domain functions call `authorize()` themselves
 * (api.spec.md's Purpose section: "principal resolved from the authenticated dev-session ...
 * permission checked directly via `deps.authorize()` — not a Bearer-JWT profile"). Every admin
 * route therefore asks for its own permission as its first step (`authorizeNewsletter` in
 * `routes/newsletter/shared.ts`), and the host mounts every newsletter spec `"direct"`.
 */

export type NewsletterEntityType = "newsletter_campaign" | "newsletter_list" | "newsletter_subscription";

/** One mapped refusal: the status and the exact flat body the admin client reads. */
export interface NewsletterErrorResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The host's typed-error -> HTTP table (errors.spec.md §2 is its canonical code -> status registry),
 * injected because the error classes are the host's. Answers `undefined` for anything it does not
 * own, so the spec rethrows it and the host's failure port answers the redacted 500.
 */
export type NewsletterErrorMapper = (required: { err: unknown }, optional?: Record<string, never>) => NewsletterErrorResponse | undefined;

/**
 * The campaign fields the specs read (the update merge, the status filter, the send chain's
 * `listId`). The host's record carries more (counters, version, timestamps); the specs answer it
 * whole, so every extra field still reaches the wire unchanged.
 */
export interface NewsletterCampaign {
  id: string;
  status: string;
  subject: string;
  /** Editorial document persisted in the host's revision JSON; absent on legacy drafts. */
  bodyJson?: Record<string, unknown> | undefined;
  preheader: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  listId: string;
}

/** `{ data: T }` envelope — api.spec.md §5's `CampaignResponse`/`NewsletterListResponse`/etc. shape. */
export function toDataResponse<T>({ data }: { data: T }, _optional: Record<string, never> = {}): { data: T } {
  return { data };
}
