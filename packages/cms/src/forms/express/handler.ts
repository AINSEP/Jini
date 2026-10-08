import type { Request, Response } from "express";
import { FormDefinitionNotFoundError, FormRateLimitExceededError, FormSubmissionValidationError } from "../errors.js";
import type { FieldDescriptor } from "../types.js";
import type { FormDefinitionRepoPort } from "../ports.js";
import type { SubmitFormInput } from "../submit-service.js";

export type FormSubmissionRedirectResult =
  | { kind: "success"; slug: string }
  | {
      kind: "validation";
      slug: string;
      fieldErrors: ReadonlyArray<{ field: string; reason: string }>;
      values?: Readonly<Record<string, string>>;
    }
  | { kind: "rate-limited"; slug: string; retryAfterSeconds: number }
  | { kind: "error"; slug: string };

/** The host owns the existing query/cookie wire format and safe site target policy. */
export interface FormSubmitResultCodec {
  encodeResultQuery: (result: FormSubmissionRedirectResult) => Iterable<[string, string]>;
  clearResultQueryParams: (params: URLSearchParams) => void;
  encodeFlashCookie: (payload: { slug: string; values: Record<string, string> }) => string | undefined;
  flashCookieName: string;
}

/** Anonymous HTTP composition; the definition read is used only to repopulate failed HTML POSTs. */
export interface CreateFormSubmitHandlerRequired {
  workspaceId: string;
  submit: (required: { input: SubmitFormInput }, optional?: Record<string, never>) => Promise<{ status: "accepted" }>;
  definitionRepo: Pick<FormDefinitionRepoPort, "findBySlug">;
  resolveClientIp: (req: Request) => string;
  isHttpsRequest: (req: Request) => boolean;
  resultCodec: FormSubmitResultCodec;
  targetRefusalReason: (target: string) => string | null;
}

/**
 * @file Public submission route for `forms` (SPEC-010 `FORMS_POST_SUBMIT`, REQ-05).
 *
 * Mirrors `routes/site/analytics-ingest.ts`'s public-route shape: no session required, registered
 * before the site `/:slug` catch-all (see `server/app.ts`'s wiring). Reuses `resolveClientIp`
 * (`core/rate-limit/rate-limit.ts`) rather than re-deriving IP resolution — all real validation
 * happens inside `submitForm` (C-008); this file owns only the HTTP boundary.
 *
 * A native `<form>` POST navigates the browser to whatever this route returns — the ORIGINAL bug
 * here (2026-08-31 fix) was that every branch replied with raw JSON, which a JS-disabled visitor saw
 * as a literal `{"status":"accepted"}` screen instead of their page. `wantsHtmlResponse` splits the
 * two audiences this endpoint actually has by content negotiation: a fetch/XHR/API caller (this
 * file's own existing tests, none of which set an `Accept` header, land here) keeps the untouched
 * JSON contract; a real browser form submission (`Accept: text/html,...`) gets a Post/Redirect/Get
 * 303 back to the page that hosted the form, with the outcome threaded through the query string via
 * {@link encodeFormSubmissionResultQuery} — `routes/site/pages.ts` decodes and splices it back into
 * that page (`http/site/render.ts`'s `injectFormSubmissionResultIntoHtml`) on the way back down.
 *
 * A validation failure ALSO sets the host's form flash cookie ({@link setFormFlashCookieForValidationFailure})
 * so the OTHER fields the visitor already typed survive that same round trip instead of coming back
 * wiped (2026-08-31 fix) — see `http/site/form-render.ts`'s "Validation flash cookie" section for why
 * this travels via a cookie rather than the query string.
 */

const MAX_BODY_STRING_LENGTH = 5000;

/** Truncates string values in an untrusted body before it reaches `submitForm`; other types pass through unchanged so `validateSubmissionPayload` can reject them by type, mirroring `analytics-ingest.ts`'s `parseBeacon`. */
function boundBody(body: unknown): Record<string, unknown> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    bounded[key] = typeof value === "string" ? value.slice(0, MAX_BODY_STRING_LENGTH) : value;
  }
  return bounded;
}

/** True for a real browser's form-POST navigation (`Accept: text/html,...`); false for the
 *  fetch/XHR/API caller shape every pre-existing test in this file already sends (`*\/*`, or no
 *  header at all), which must keep getting the untouched JSON contract. */
function wantsHtmlResponse(req: Request): boolean {
  return (req.get("accept") ?? "").includes("text/html");
}

/**
 * Resolves the safe base URL {@link redirectWithFormResult} rebuilds its Location around. `Referer`
 * is the only signal available for "which page hosted this form" — `render.ts`'s
 * `renderWidgetContactForm` has no request in scope to stash a return path in (see that file's own
 * module doc) — and it is entirely visitor-controlled: a hostile page anywhere on the internet can
 * point a plain `<form>` at this exact endpoint and set its own Referer to whatever it likes.
 * Redirecting there unchecked would turn this endpoint into an open redirect (secure-input-handling:
 * untrusted header). Comparing `refUrl.host` against this REQUEST's own `Host` header closes that
 * off — an absent, unparsable, or cross-origin Referer all fall back to the site root instead, a
 * real and safe page rather than a raw JSON blob, just not necessarily the one the visitor submitted
 * from.
 *
 * The host match alone is not enough (t91 open-redirect sweep, 2026-09-16): the Location is rebuilt
 * from the Referer's `pathname` + `search` only, and `http://site//evil.example/x` (or the `/\` and
 * `/.//` spellings a URL parser folds into it) has the right host but a pathname of
 * `//evil.example/x` — a protocol-relative Location. The pathname must also pass the redirects write
 * gate's site-relative check, which refuses that shape (and the admin surface) the same way.
 */
function resolveSameOriginRedirectBase(req: Request, targetRefusalReason: CreateFormSubmitHandlerRequired["targetRefusalReason"]): URL {
  const fallback = new URL("/", `${req.protocol}://${req.get("host") ?? "localhost"}`);
  const referer = req.get("referer");
  if (!referer) return fallback;
  try {
    const refUrl = new URL(referer);
    const onThisSite = refUrl.host === req.get("host") && targetRefusalReason(refUrl.pathname) === null;
    return onThisSite ? refUrl : fallback;
  } catch {
    return fallback;
  }
}

/** Issues the Post/Redirect/Get 303 a JS-disabled form submission needs: back to the same-origin
 *  page {@link resolveSameOriginRedirectBase} resolved, with any PRIOR `form_*` result params
 *  cleared (so resubmitting doesn't accumulate stale ones from an earlier visit) and `result`'s own
 *  freshly encoded in their place. */
function redirectWithFormResult(req: Request, res: Response, result: FormSubmissionRedirectResult, deps: CreateFormSubmitHandlerRequired): void {
  const target = resolveSameOriginRedirectBase(req, deps.targetRefusalReason);
  deps.resultCodec.clearResultQueryParams(target.searchParams);
  for (const [key, value] of deps.resultCodec.encodeResultQuery(result)) target.searchParams.set(key, value);
  res.redirect(303, `${target.pathname}${target.search}`);
}

// ---------------------------------------------------------------------------
// Validation flash cookie (2026-08-31 field-wipe fix) — see `http/site/form-render.ts`'s own
// "Validation flash cookie" section header for the full mechanism this half feeds.
// ---------------------------------------------------------------------------

const FORM_FLASH_COOKIE_MAX_AGE_SECONDS = 120;

/** Field types eligible to be echoed back into the flash cookie — an ALLOWLIST, not a denylist, so a
 *  future `FieldType` this codebase has not added yet (a `password` type, say) is excluded the
 *  moment it exists, with zero code change required here: only a type explicitly added to this set
 *  is ever repopulated. `checkbox` is excluded too — its stored value is a boolean-ish flag, never
 *  text a visitor "typed" and could lose, so the bug this fixes never applied to it. */
const REPOPULATABLE_FIELD_TYPES: ReadonlySet<string> = new Set(["text", "email", "textarea"]);

/** Extracts the submitted values worth flashing back: only fields BOTH declared on this form AND of
 *  a {@link REPOPULATABLE_FIELD_TYPES} type — iterating `fields` (not `body`'s own keys) means a
 *  non-field key like the honeypot (`_hp`) is excluded automatically, never by a separate denylist
 *  check. Per-value/total-size bounding for the cookie itself is `encodeFormFlashCookieValue`'s own
 *  job (`form-render.ts`), not duplicated here.
 * @complexity O(f) in the form's own declared field count (bounded by forms' `MAX_FIELDS`). */
function buildFormFlashValues(fields: readonly FieldDescriptor[], body: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (!REPOPULATABLE_FIELD_TYPES.has(field.type)) continue;
    const raw = body[field.id];
    if (typeof raw === "string" && raw !== "") values[field.id] = raw;
  }
  return values;
}

/** Sets the short-lived, read-once flash cookie a validation-failure redirect uses to survive the
 *  303's fresh GET with the visitor's OTHER field values intact (2026-08-31 fix — see this route's
 *  own module doc header, and `form-render.ts`'s "Validation flash cookie" section, for the full
 *  round trip). `HttpOnly` — this mechanism exists so the JS-DISABLED path works, there is no reason
 *  to also expose it to page JS. `SameSite=Lax`, not `Strict` — the cookie's only read happens on
 *  this SAME redirect's own follow-up GET, a top-level same-site navigation `Lax` already allows,
 *  mirroring `complete-sign-in.ts`'s identical `SameSite=Lax` rationale. `Secure` only when
 *  {@link isHttpsRequest} — unlike `dev-auth.ts`'s/`complete-sign-in.ts`'s always-on `Secure` (both
 *  gate a real login session), an unconditional `Secure` here would silently break this exact feature
 *  on a plain `http://localhost` dev/test run.
 *
 * `encodeFormFlashCookieValue` returning `undefined` (the submission's own values did not fit even
 * after truncation/dropping) is a silent no-op — the redirect still happens; the visitor just sees
 * the pre-fix wiped-fields behavior for that one oversized submission rather than a broken
 * `Set-Cookie` header. */
function setFormFlashCookie(req: Request, res: Response, payload: { slug: string; values: Record<string, string> }, deps: CreateFormSubmitHandlerRequired): void {
  const json = deps.resultCodec.encodeFlashCookie(payload);
  if (!json) return;
  res.cookie(deps.resultCodec.flashCookieName, json, {
    httpOnly: true, path: "/", maxAge: FORM_FLASH_COOKIE_MAX_AGE_SECONDS * 1000,
    sameSite: "lax", secure: deps.isHttpsRequest(req),
  });
}

/** Builds and sets the flash cookie for a validation failure reached via a real browser form POST.
 *  Looks up the form's field descriptors a SECOND time — `submitForm` already did once, internally,
 *  to build `err.fieldErrors`, but that lookup's own `FormDefinitionRecord` never escapes
 *  `submit-service.ts` — so this route can filter by field `type` without widening `submitForm`'s
 *  own return/throw contract for a single caller's cookie concern. The extra read only happens on
 *  the HTML/validation-failure path, never on every submission. A workspace/slug with no matching
 *  definition (should not happen — `submitForm` just resolved the same slug successfully enough to
 *  reach validation) degrades to an empty field list rather than throwing. */
async function setFormFlashCookieForValidationFailure(
  req: Request,
  res: Response,
  deps: CreateFormSubmitHandlerRequired,
  slug: string,
  body: Record<string, unknown>
): Promise<void> {
  const definition = await deps.definitionRepo.findBySlug({ workspaceId: deps.workspaceId, slug });
  const values = buildFormFlashValues(definition?.fields ?? [], body);
  if (Object.keys(values).length === 0) return;
  setFormFlashCookie(req, res, { slug, values }, deps);
}

/** One submission's outcome, in both shapes this route can answer with — collapses what would
 *  otherwise be a `wantsHtmlResponse` branch repeated at every error type (pushing this handler's
 *  own cyclomatic complexity well past the project's ceiling) down to the single dispatch in
 *  {@link sendFormSubmitOutcome}. */
interface FormSubmitOutcome {
  redirectResult: FormSubmissionRedirectResult;
  json: { status: number; body: Record<string, unknown> };
}

function outcomeForSuccess(slug: string, result: { status: "accepted" }): FormSubmitOutcome {
  return { redirectResult: { kind: "success", slug }, json: { status: 201, body: result } };
}

/** Maps `submitForm`'s three typed failure modes (REQ-05/07's error taxonomy) to both response
 *  shapes at once; an error `submitForm` never actually raises today still degrades to a generic
 *  500/`"error"` pair rather than throwing out of this mapper. */
function outcomeForError(slug: string, err: unknown): FormSubmitOutcome {
  if (err instanceof FormDefinitionNotFoundError) {
    return { redirectResult: { kind: "error", slug }, json: { status: 404, body: { error: err.message, code: "FORMS_DEFINITION_NOT_FOUND" } } };
  }
  if (err instanceof FormSubmissionValidationError) {
    return {
      redirectResult: { kind: "validation", slug, fieldErrors: err.fieldErrors },
      json: { status: 400, body: { error: err.message, code: "FORMS_SUBMISSION_VALIDATION_ERROR", details: { fieldErrors: err.fieldErrors } } },
    };
  }
  if (err instanceof FormRateLimitExceededError) {
    return {
      redirectResult: { kind: "rate-limited", slug, retryAfterSeconds: err.retryAfterSeconds },
      json: { status: 429, body: { error: err.message, code: "FORMS_RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: err.retryAfterSeconds } } },
    };
  }
  return { redirectResult: { kind: "error", slug }, json: { status: 500, body: { error: "internal error", code: "INTERNAL_ERROR" } } };
}

function sendFormSubmitOutcome(req: Request, res: Response, outcome: FormSubmitOutcome, deps: CreateFormSubmitHandlerRequired): void {
  if (wantsHtmlResponse(req)) {
    redirectWithFormResult(req, res, outcome.redirectResult, deps);
    return;
  }
  res.status(outcome.json.status).json(outcome.json.body);
}

/** Registers `POST /forms/:slug/submit`. Must be registered BEFORE the site `/:slug` catch-all.
 *
 * `express.urlencoded` is mounted on THIS route's own POST registration (not a global `app.ts`
 * mount — same scoping precedent as `template-preview.ts`'s `POST` handler) because a real,
 * JavaScript-disabled `<form method="post">` — the exact case this file's Post/Redirect/Get fix
 * exists for — always encodes its body as `application/x-www-form-urlencoded`, which `app.ts`'s
 * blanket `express.json()` cannot parse; without this, every field on a genuine browser submission
 * would silently arrive as missing, failing REQUIRED-field validation on every real, non-JS
 * submission regardless of the redirect fix. A `fetch`/JSON caller (every pre-existing test in this
 * file) is unaffected — Express dispatches to whichever parser matches the request's actual
 * `Content-Type`, so mounting both here is additive, never a double-parse of the same request. */
export function createFormSubmitHandler(
  deps: CreateFormSubmitHandlerRequired,
  _optional: Record<string, never> = {},
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const body = boundBody(req.body);
    const sourceIp = deps.resolveClientIp(req);

    try {
      const result = await deps.submit({
        input: { workspaceId: deps.workspaceId, slug, body, sourceIp },
      });
      sendFormSubmitOutcome(req, res, outcomeForSuccess(slug, result), deps);
    } catch (err) {
      if (err instanceof FormSubmissionValidationError && wantsHtmlResponse(req)) {
        try {
          await setFormFlashCookieForValidationFailure(req, res, deps, slug, body);
        } catch (flashErr) {
          console.error(`[site/forms-submit] failed to set validation flash cookie (slug=${slug})`, flashErr);
        }
      }
      sendFormSubmitOutcome(req, res, outcomeForError(slug, err), deps);
    }
  };
}
