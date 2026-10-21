/** Evidence adapter over the shared render function. Optional-import, sandbox and privacy
 * rationale moved with the browser opener to playwright-runtime.ts; context lifecycle is in
 * render-page.ts. Keeping one opener avoids a second vendor/browser stack for public reads. */
import { buildPagePerformanceExpression, type PagePerformanceEvidence } from "./page-performance-script.js";
import type {
  CookieEvidence,
  ObservationPhase,
  ObservePageRequest,
  ObservePageResult,
  ObservePageOptions,
  PageObservation,
  RequestEvidence,
  SiteEvidenceBrowserAvailability,
  SiteEvidenceBrowserPort,
} from "./browser-port.js";
import { collectPageStructure, type PageStructureCapture, type PageStructureLimits } from "./page-structure-script.js";
import { renderPage, OffOriginNavigationError, type RenderBrowser, type RenderCookie as PwCookie, type RenderPage as PwPage } from "./render-page.js";
import { openPlaywrightRenderBrowser, type PlaywrightAdapterOptions } from "./playwright-runtime.js";
export { openPlaywrightRenderBrowser, PUBLIC_RENDER_LAUNCH_OPTIONS } from "./playwright-runtime.js";
export type { PlaywrightLike, PlaywrightAdapterOptions } from "./playwright-runtime.js";
export * from "./render-page.js";
export { PageWorkTimeout } from "./page-work-budget.js";
export * from "./request-guard.js";
export * from "./lazy-browser.js";
import { PageWorkBudget, PageWorkTimeout } from "./page-work-budget.js";

/** How long to wait for the page to settle after the consent click before re-reading state. Short
 *  on purpose: this is a debounce for the widget's own DOM/network reaction, not a crawl budget,
 *  and it is charged against the same per-page timeout as everything else. */
const CONSENT_SETTLE_MS = 1_500;

// ---------------------------------------------------------------------------
// The structural slice of Playwright this adapter uses. See the file header.
// ---------------------------------------------------------------------------

/** Evidence facade over the same browser opener and render lifecycle used for public reading. */
export async function openPlaywrightSiteEvidenceBrowser(
  required: Record<string, never>, options: PlaywrightAdapterOptions = {},
): Promise<SiteEvidenceBrowserAvailability> {
  const opened = await openPlaywrightRenderBrowser(required, options);
  return opened.available ? { available: true, browser: new PlaywrightSiteEvidenceBrowser({ browser: opened.browser }, options) } : opened;
}

class PlaywrightSiteEvidenceBrowser implements SiteEvidenceBrowserPort {
  private readonly browser: RenderBrowser;
  private readonly routerFactory: PlaywrightAdapterOptions["routerFactory"];
  constructor({ browser }: { browser: RenderBrowser }, options: PlaywrightAdapterOptions = {}) {
    this.browser = browser; this.routerFactory = options.routerFactory;
  }

  /**
   * Loads one page in a fresh ephemeral context and returns what was observed.
   *
   * @returns `{ ok: false, reason }` for any navigation failure or timeout — one unreachable page
   * must not end the whole run, and "this page could not be loaded" is itself evidence the report
   * is required to state.
   * @complexity One page load bounded by `request.timeoutMs`, plus one in-page DOM walk bounded by
   * the per-category caps in `request`.
   */
  async observe(required: ObservePageRequest, options: ObservePageOptions = {}): Promise<ObservePageResult> {
    const request = { ...required, ...options };
    const abort = new AbortController();
    const router = this.routerFactory?.({ originBaseUrl: request.originBaseUrl, signal: abort.signal });
    const requests: RequestEvidence[] = [];
    const notes: string[] = [];
    let phase: ObservationPhase = "before";
    let result: ObservePageResult;
    try {
      result = await renderPage({
        browser: this.browser, url: request.url,
        consume: async ({ page, context, response, finalUrl, budget }): Promise<ObservePageResult> => {
          if (!response) return { ok: false, reason: "the browser produced no response for this navigation (no HTTP exchange to observe)" };
          const structureLimits: PageStructureLimits = {
            maxTextExcerptChars: request.maxTextExcerptChars,
            maxNodesPerCategory: request.maxAccessibilityNodesPerCategory,
            maxContrastSamples: request.maxContrastSamples,
            collectAccessibility: request.collectAccessibility,
          };
          // A page can navigate, close or crash after goto (Execution context was destroyed).
          // Such gaps remain evidence, never an exception that ends the whole collection run.
          const structure = await budget.run({ work: async () => await page.evaluate(buildPageStructureExpression(structureLimits)) as PageStructureCapture });
          if (request.consentAcceptSelector !== undefined) {
            await this.performConsentClick(page, request, notes, () => { phase = "after"; }, budget);
          }
          if (!context.cookies) throw new Error("Browser cannot observe cookies");
          const cookies = await budget.run({ work: () => context.cookies!() });
          let performance: PagePerformanceEvidence | undefined;
          if (request.collectPerformance) {
            performance = await budget.run({ work: async () => await page.evaluate(buildPagePerformanceExpression({})) as PagePerformanceEvidence });
          }
          return { ok: true, observation: { ...buildObservation({
            request, finalUrl, httpStatus: response.status(), headers: response.headers?.() ?? {},
            title: structure.title, structure, cookies, requests, notes, consentPhase: phase,
          }), ...(performance ? { performance } : {}) } };
        },
      }, {
        ...(router ? { router } : {}), signal: abort.signal,
        timeoutMs: request.timeoutMs, originBaseUrl: request.originBaseUrl,
        // Consent evidence must stay pre-consent until the operator's explicit selector is clicked.
        dismissCookieBanners: false, loadWaitMs: 5_000,
        onRequest: ({ route, blocked }) => {
          const pending = route.request();
          const requestIndex = requests.length;
          recordRequest(requests, request, {
            method: pending.method().toUpperCase(), url: pending.url(), resourceType: pending.resourceType(), phase,
            ...(blocked ? { blockedReason:
              "aborted: this tool never sends a non-GET request, so no form, consent preference, or " +
              "analytics beacon it observes is ever actually submitted. Off-origin navigation is also refused." } : {}),
          });
          // Preserve the phase of the attempt even if a DNS/transport refusal finishes after consent.
          return ({ reason }: { reason: string }) => {
            const observed = requests[requestIndex];
            if (observed) requests[requestIndex] = { ...observed, blockedReason: reason };
          };
        },
      });
    } catch (error) {
      result = { ok: false, reason: `page capture failed after load or navigation: ${messageOf(error)}`, ...(error instanceof OffOriginNavigationError ? { offOriginUrl: error.origin } : {}) };
    } finally {
      abort.abort();
    }
    return result;
  }

  async close(_required: Record<string, never>): Promise<void> {
    await this.browser.close();
  }

  /**
   * Clicks the operator-named consent control exactly once, flipping the observation phase.
   *
   * A selector that matches nothing is a NOTE, not a failure: "the consent selector you gave me
   * matched no element on this page" is precisely the kind of thing the report must say out loud,
   * and turning it into a thrown error would lose the rest of the page's evidence with it.
   */
  private async performConsentClick(
    page: PwPage,
    request: ObservePageRequest & ObservePageOptions,
    notes: string[],
    markAfterPhase: () => void,
    budget: PageWorkBudget,
  ): Promise<void> {
    const selector = request.consentAcceptSelector as string;
    let matches: number;
    try {
      matches = await budget.run({ work: () => page.locator!(selector).count() });
    } catch (error) {
      if (error instanceof PageWorkTimeout) throw error;
      notes.push(`consent selector '${selector}' is not a usable selector on this page: ${messageOf(error)}`);
      return;
    }

    if (matches === 0) {
      notes.push(
        `consent selector '${selector}' matched no element on this page — no consent interaction was performed, ` +
          "so nothing below distinguishes pre-consent from post-consent behaviour",
      );
      return;
    }

    markAfterPhase();
    try {
      await budget.run({ work: () => page.locator!(selector).first().click({ timeout: Math.min(budget.remainingMs(), 5_000) }) });
      await budget.run({ work: () => page.waitForTimeout(CONSENT_SETTLE_MS) });
      notes.push(
        `consent selector '${selector}' matched ${matches} element(s); the first was clicked. Cookies and requests ` +
          "observed after that point are marked phase 'after'.",
      );
    } catch (error) {
      if (error instanceof PageWorkTimeout) throw error;
      notes.push(
        `consent selector '${selector}' matched ${matches} element(s) but the click did not complete: ${messageOf(error)}. ` +
          "Post-consent evidence below is incomplete and must not be read as showing what a real visitor would see.",
      );
    }
  }
}

/**
 * Builds the self-contained JavaScript expression that runs `collectPageStructure` inside the page.
 *
 * **Why not just `page.evaluate(collectPageStructure, limits)`.** That was the obvious first
 * implementation and it fails at runtime, in the browser, with `ReferenceError: __name is not
 * defined` — found by this feature's real-browser integration test, and invisible to every
 * fake-browser test and to `tsc`. The cause: esbuild (which `tsx` uses, and which any bundler with
 * `keepNames` enabled uses) rewrites nested function declarations as
 * `var f = __name(function f() {...}, "f")` and emits `__name` as a MODULE-scope helper. Playwright
 * serialises only the function's own source text, so the helper it now depends on is left behind on
 * the Node side and the page hits an undefined identifier.
 *
 * The fix is to ship a one-line `__name` shim into the page alongside the function source, inside an
 * IIFE so both stay out of the page's own global scope. That makes the evaluated code genuinely
 * self-contained — which is what `page-structure-script.ts`'s header already claims, and now
 * actually is under every transpiler this repo runs through.
 *
 * `limits` is embedded as a JSON literal rather than passed as an argument for the same reason:
 * one string, no second serialization path that could behave differently.
 *
 * @complexity O(n) in the function's own source length.
 */
function buildPageStructureExpression(limits: PageStructureLimits): string {
  return (
    "(() => {" +
    // The shim. Identity, because name preservation has no meaning in the page.
    "var __name = function (fn) { return fn; };" +
    `var __collect = ${collectPageStructure.toString()};` +
    `return __collect(${JSON.stringify(limits)});` +
    "})()"
  );
}

interface RecordRequestInput {
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly phase: ObservationPhase;
  readonly blockedReason?: string;
}

/**
 * Appends one request observation, applying the cap.
 *
 * At the cap the request is dropped rather than replacing an earlier one: the earliest requests are
 * the ones a pre-consent finding turns on, so keeping the head of the list and reporting truncation
 * is the ordering that preserves the evidence that matters. Truncation is surfaced to the caller by
 * the list length equalling `maxRequests`, which the result's own `limits` block makes checkable.
 *
 * @complexity O(1) per request.
 */
function recordRequest(sink: RequestEvidence[], request: ObservePageRequest, input: RecordRequestInput): void {
  if (sink.length >= request.maxRequests) return;

  let host: string;
  let hostname: string;
  let pathname: string;
  try {
    const parsed = new URL(input.url);
    // `host` (with port) is what gets CITED — a reader needs to see the exact authority the browser
    // talked to. `hostname` (without) is what the first-party comparison uses; see `sameHost`.
    host = parsed.host;
    hostname = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    host = "(unparseable)";
    hostname = "(unparseable)";
    pathname = "(unparseable)";
  }

  sink.push({
    method: input.method,
    host,
    pathname,
    resourceType: input.resourceType,
    firstParty: sameHost(request.originBaseUrl, hostname),
    phase: input.phase,
    ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
  });
}

interface BuildObservationInput {
  readonly request: ObservePageRequest;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly headers: Record<string, string>;
  readonly title: string;
  readonly structure: PageStructureCapture;
  readonly cookies: readonly PwCookie[];
  readonly requests: readonly RequestEvidence[];
  readonly notes: readonly string[];
  readonly consentPhase: ObservationPhase;
}

/** Assembles the port-shaped observation. Pure — every input has already been gathered, so this is
 *  the seam a unit test can exercise without a browser. */
function buildObservation(input: BuildObservationInput): PageObservation {
  const { request, structure } = input;

  return {
    document: {
      httpStatus: input.httpStatus,
      finalUrl: input.finalUrl,
      redirected: normalizeUrlForComparison(input.finalUrl) !== normalizeUrlForComparison(request.url),
      title: input.title,
      lang: structure.lang,
      headers: Object.entries(input.headers).map(([name, value]) => ({ name, value })),
      textExcerpt: structure.textExcerpt,
      textTruncated: structure.textTruncated,
    },
    cookies: input.cookies.slice(0, request.maxCookies).map((cookie) => toCookieEvidence(cookie, request, input.consentPhase)),
    requests: input.requests,
    ...(request.collectAccessibility ? { accessibility: structure.accessibility } : {}),
    notes: [
      ...input.notes,
      ...(input.cookies.length > request.maxCookies
        ? [`cookie list truncated at the ${request.maxCookies}-cookie cap (${input.cookies.length} were present)`]
        : []),
    ],
  };
}

/**
 * Converts one Playwright cookie into evidence — **dropping its value on the floor**, which is the
 * point (`browser-port.ts`'s header). A session cookie's value is very often a user identifier;
 * copying it into a report would put a real visitor's session token into an LLM's context.
 *
 * The phase is the phase the CONTEXT was in when cookies were read. Playwright's cookie jar has no
 * per-cookie set time, so a cookie observed after a consent click cannot be attributed to before or
 * after it from the jar alone. The honest reading, stated in the compliance skill's procedure, is
 * to compare a `consentAction: none` run's cookies against an accepted run's — which is why the
 * phase is recorded rather than guessed at per cookie.
 */
function toCookieEvidence(cookie: PwCookie, request: ObservePageRequest, phase: ObservationPhase): CookieEvidence {
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expiresAt: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null,
    firstParty: sameHost(request.originBaseUrl, cookie.domain.replace(/^\./, "")),
    phase,
  };
}

/**
 * Hostname equality against the site's own origin — the `firstParty` flag.
 *
 * **`hostname`, not `host`, and that distinction was a real bug.** `URL.host` includes the port; a
 * cookie's `domain` never does. Comparing `host` therefore classified every first-party cookie on a
 * non-default port as THIRD-PARTY — caught by the real-browser integration test against a fixture
 * server on an ephemeral port, and it would have been a silently wrong citation in a privacy
 * finding, which is the worst failure this tool has available.
 *
 * An unparseable base URL must fail closed (treated as third-party): over-reporting third-party
 * makes a screening noisier, under-reporting it makes a screening wrong. That failure is taken
 * upstream, before this comparison can run: `observe` renders under the same-origin policy, whose
 * `assertNavigable` → `isSameOriginUrl` treats an unparseable base as off-origin and refuses the
 * navigation before any request or cookie is recorded. Every call here therefore has a base that
 * already parsed, so no local parse guard is needed.
 */
function sameHost(originBaseUrl: string, hostname: string): boolean {
  return new URL(originBaseUrl).hostname.toLowerCase() === hostname.toLowerCase();
}

/** Strips a single trailing slash so `https://x/pricing` and `https://x/pricing/` do not read as a
 *  redirect. Anything else that differs genuinely is one. */
function normalizeUrlForComparison(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export { renderPublicPage, createJsonCapture, publicPageExpression } from "./public-page.js";
export type { PublicPageInput, PublicPageCapture, CapturedJsonResponse } from "./public-page.js";
