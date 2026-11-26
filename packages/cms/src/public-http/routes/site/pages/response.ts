import { addDeclaredHostsToPolicy, CSP_REPORT_ONLY_HEADER, type DeclaredPageHosts } from '@jini-ai/core/contracts/server/security-headers';
import { mergeFormFlashIntoResult, type FormFlashPayload } from '../../../../forms/result-flash.js';
import type { FormSubmissionRedirectResult } from '../../../../forms/types.js';
import { injectListingScript } from '../../../../listing/index.js';
import { injectExtraHeadIntoStaticPage } from '../../../../presentation/html.js';

/** {@link resolvePerVisitorResponse}'s two outputs: the form result to splice into the HTML (if
 *  any), and the `Cache-Control` this response must therefore send. Returned together, from the one
 *  place that knows whether ANY per-visitor state was in play, so no render branch can splice
 *  per-visitor content in and then pick the header independently — the defect this shape replaces
 *  ({@link CACHE_CONTROL_PRIVATE_FORM_RESULT} documents it). */
export interface PerVisitorResponse {
  readonly result: FormSubmissionRedirectResult | undefined;
  readonly cacheControl: string;
}

/**
 * Resolves everything about this request that makes its response PER-VISITOR rather than shared:
 * the {@link FormSubmissionRedirectResult} to splice into the HTML, if any, AND the one
 * `Cache-Control` directive the response must therefore send.
 *
 * The form half: the query-string result (`decodeFormSubmissionResultFromQuery`) plus, for a
 * `"validation"` result, the same-slug flash cookie's field values (`mergeFormFlashIntoResult`) so
 * the OTHER fields the visitor already typed survive the Post/Redirect/Get round trip instead of
 * coming back wiped (2026-08-31 fix). The flash cookie is READ-ONCE: whether or not one was present,
 * it is cleared on `res` right here, in the same response that reads it.
 *
 * Resolved ONCE per request and threaded to every render branch — the same "compute once, thread to
 * every branch" shape `siteAssistantEnabled` already uses on the `/:slug` handler (ADR-054). That is
 * load-bearing for the header, not just tidy: this is the single place that knows whether ANY
 * per-visitor state was in play, so no render branch can splice per-visitor content in and then pick
 * its own directive independently. See {@link CACHE_CONTROL_PRIVATE_FORM_RESULT} for the defect that
 * split ownership produced the first time.
 *
 * Named for what it resolves, not for forms alone (was `resolveFormSubmissionResult`): the
 * member-session arm below is a second, entirely independent per-visitor trigger, and a request may
 * carry both cookies at once.
 *
 * @complexity O(1) plus the bounded cost already documented on the functions it calls.
 */
export function resolveVisitorPagePolicy({ queryResult, flash, clearFlash, memberCookiePresent, staticExport, cache }: {
  queryResult: FormSubmissionRedirectResult | undefined; flash: FormFlashPayload | undefined;
  clearFlash: (required: Record<string, never>) => void;
  memberCookiePresent: (required: Record<string, never>) => boolean;
  staticExport: (required: Record<string, never>) => boolean;
  cache: { form: string; member: string; staticExport: string; public: string };
}, _optional = {}): PerVisitorResponse {
  if (flash) clearFlash({});
  const result = mergeFormFlashIntoResult({ result: queryResult, flash });
  // Both arms matter, and neither implies the other. `result` covers a PRG landing whose body gets
  // rewritten. `flash` covers the case where the merge dropped it (no `form_*` params, or a
  // different form's slug) yet a read-once cookie was still consumed and cleared ON THIS RESPONSE —
  // storing that response would let a shared cache replay the clearing `Set-Cookie` to other
  // visitors and outlive the cookie it retired.
  if (result !== undefined || flash !== undefined) return { result, cacheControl: cache.form };
  // The member arm, checked on cookie PRESENCE alone — see
  // {@link CACHE_CONTROL_PRIVATE_MEMBER_RESPONSE}'s own doc for why not on "the filter dropped
  // something." Ordering between the two private arms is cosmetic (both resolve to the same
  // never-store literal); what matters is that `public` is reachable ONLY when NEITHER trigger
  // fired, so a request carrying both cookies can never fall back to it through either path.
  if (memberCookiePresent({})) return { result, cacheControl: cache.member };
  // The static-export marker changes the body (no visitor-chat widget), so it is a per-visitor
  // trigger too — see {@link isStaticExportRequest}.
  if (staticExport({})) return { result, cacheControl: cache.staticExport };
  return { result, cacheControl: cache.public };
}

export function publicPageCache({ html, cacheControl: routeCache, preConsentCacheControl, hasConsentGatedScripts }: {
  html: string; cacheControl: string;
  preConsentCacheControl: (required: { html: string; cacheControl: string }) => string;
  hasConsentGatedScripts: (required: { html: string }) => boolean;
}, _optional = {}): { cacheControl: string; varyCookie: boolean } {
  // Live comments never enter browser/CDN caches; approval, selection and disable take effect on the next request.
  const routeCacheControl = html.includes('data-comments-surface') ? 'private, no-store' : routeCache;
  // G7-8: a pre-consent page carrying consent-gated tracking scripts never enters a shared cache.
  const cacheControl = preConsentCacheControl({ html, cacheControl: routeCacheControl });
  // A consent-gated page that is still cacheable here was rendered for a visitor with a consent choice,
  // while the cookie-free variant is `no-store`: key shared caches on the cookie so one is never
  // replayed to the other. `res.vary` merges with any Vary header already set.
  return { cacheControl, varyCookie: !/\b(private|no-store)\b/.test(cacheControl) && hasConsentGatedScripts({ html }) };
}

export async function finalizePublicPageHtml({ html, formResult, ports }: {
  html: string; formResult: FormSubmissionRedirectResult | undefined;
  ports: {
    listingBatchBody(required: { html: string }): { format: string; body: string } | undefined;
    assertListingPageServed(required: { html: string }): void;
    pluginHead(required: Record<string, never>): string | undefined;
    addPluginHosts(required: Record<string, never>): void;
    widgetPartials(required: { html: string }): Promise<string>;
    finishFormResult(required: { html: string; formResult: FormSubmissionRedirectResult | undefined }): string;
    staticExport(required: Record<string, never>): boolean;
    formAttemptTokens(required: { html: string }): string;
    memberAuthScript(required: { html: string }): string;
  };
}, _optional = {}): Promise<{ html: string; contentType?: 'json' }> {
  const batchBody = ports.listingBatchBody({ html });
  if (batchBody !== undefined) return { html: batchBody.body, ...(batchBody.format === 'json' ? { contentType: 'json' as const } : {}) };
  ports.assertListingPageServed({ html });
  html = injectExtraHeadIntoStaticPage({ html, extraHead: ports.pluginHead({}) });
  ports.addPluginHosts({});
  html = injectListingScript({ html });
  html = await ports.widgetPartials({ html });
  const finished = ports.finishFormResult({ html, formResult });
  // Member sign-in needs this server's API, which an exported file never has: its header keeps the
  // theme's plain "Sign in" link.
  if (ports.staticExport({})) return { html: finished };
  return { html: ports.memberAuthScript({ html: ports.formAttemptTokens({ html: finished }) }) };
}

/** The page's report-only policy names what its plugin exports declared; nothing is added otherwise. O(hosts). */
export function addPluginExportHostsToResponse({ response, hosts }: { response: { getHeader?: (name: string) => unknown; setHeader: (name: string, value: string) => unknown } | undefined; hosts: DeclaredPageHosts | undefined }, _optional: Record<string, never> = {}): void {
  const policy = response?.getHeader?.(CSP_REPORT_ONLY_HEADER);
  if (hosts && response && typeof policy === "string") response.setHeader(CSP_REPORT_ONLY_HEADER, addDeclaredHostsToPolicy({ policy, hosts }));
}
