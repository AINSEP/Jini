/**
 * @file The one and only module in this repository that touches a real headless browser.
 * Implements `SiteEvidenceBrowserPort` (`browser-port.ts`) on Playwright's Chromium.
 *
 * ---------------------------------------------------------------------------
 * Why the import is dynamic, and why the module's types are declared here
 * ---------------------------------------------------------------------------
 * The host may optionally install `playwright`; this package adds no browser dependency. The BROWSER
 * BINARY it drives needs a separate `playwright install chromium` step in the host deployment.
 * Installing the module alone does not supply that binary. So both halves can
 * legitimately be missing at runtime, independently:
 *
 * - the module itself, on a deployment that pruned it;
 * - the Chromium binary, on a deployment that installed the module but not the browser.
 *
 * Both are caught here and converted into `{ available: false, reason }`, never a thrown error and
 * never a boot failure. The tool then reports "no browser in this deployment" and the compliance
 * skill is required by its own output contract to downgrade every rendered-truth finding to
 * `cannot-determine`. That is the entire reason this adapter must not be a static import: a static
 * one would make an optional capability a hard boot dependency for every host install.
 *
 * {@link PlaywrightLike} declares, structurally, exactly the eight or so members this adapter uses.
 * That is deliberate rather than importing Playwright's own (very large) `.d.ts`: typechecking this
 * repository must not depend on a browser automation library's type surface being resolvable, and
 * naming the members used makes the actual coupling one short, reviewable block instead of an
 * open-ended import.
 *
 * ---------------------------------------------------------------------------
 * Privacy properties, enforced here rather than promised
 * ---------------------------------------------------------------------------
 * - **Ephemeral context.** `browser.newContext()` with no `storageState` and no user-data
 *   directory. Cookies, storage, and cache exist only in memory and die with `close()`. Nothing is
 *   written to disk by this module.
 * - **One context per page.** Each `observe()` call gets a fresh context, so a cookie set by page A
 *   can never be reported as though page B set it — which would be an outright false citation in a
 *   pre-consent cookie finding.
 * - **No non-GET request ever leaves the process.** Every request is intercepted; anything that is
 *   not GET or HEAD is aborted and recorded as blocked. This is what makes "never submits forms" a
 *   structural property instead of a policy: even if a page auto-submits, or a consent widget POSTs
 *   preferences, the attempt is observed and the bytes do not go out.
 * - **Values are never read.** Cookie values, request bodies, and form-field values are not
 *   extracted anywhere below, because `browser-port.ts`'s shapes have nowhere to put them.
 */
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
import { PageWorkBudget, PageWorkTimeout } from "./page-work-budget.js";

/** Methods allowed out of the browser. Everything else is aborted — see this file's header. */
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** How long to wait for the page to settle after the consent click before re-reading state. Short
 *  on purpose: this is a debounce for the widget's own DOM/network reaction, not a crawl budget,
 *  and it is charged against the same per-page timeout as everything else. */
const CONSENT_SETTLE_MS = 1_500;

// ---------------------------------------------------------------------------
// The structural slice of Playwright this adapter uses. See the file header.
// ---------------------------------------------------------------------------

interface PwRoute {
  request(): PwRequest;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

interface PwRequest {
  url(): string;
  method(): string;
  resourceType(): string;
}

interface PwResponse {
  status(): number;
  url(): string;
  headers(): Record<string, string>;
}

interface PwCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface PwLocator {
  first(): PwLocator;
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
}

interface PwPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<PwResponse | null>;
  /** Only the STRING form is used — see {@link buildPageStructureExpression} for why passing the
   *  function reference directly is not safe here. */
  evaluate<T>(expression: string): Promise<T>;
  locator(selector: string): PwLocator;
  waitForTimeout(ms: number): Promise<void>;
  title(): Promise<string>;
}

interface PwContext {
  newPage(): Promise<PwPage>;
  route(pattern: string, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
  cookies(): Promise<PwCookie[]>;
  close(): Promise<void>;
}

interface PwBrowser {
  newContext(options?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

export interface PlaywrightLike {
  chromium: {
    launch(options?: { headless?: boolean; args?: readonly string[] }): Promise<PwBrowser>;
  };
}

/**
 * Opens a real Chromium and returns a `SiteEvidenceBrowserPort` over it, or explains why this
 * deployment cannot.
 *
 * @returns `{ available: true, browser }` on success; `{ available: false, reason }` when the
 * `playwright` module or its Chromium binary is not present. Never throws for either case — see
 * this file's header for why an absent browser must be a reportable state rather than an error.
 * @complexity One process launch. The caller is responsible for calling `close()`, which
 * `collectPageEvidence` does in a `finally`.
 */
export interface PlaywrightAdapterOptions {
 readonly moduleLoader?: { load(required: { moduleName: string }): Promise<PlaywrightLike> };
 readonly launchOptions?: { headless?: boolean; args?: string[] };
}

/** Opens the optional browser capability; import and launch failures become availability results. */
// A successful launch transfers process ownership to the caller; close the browser in a finally
// block so an unreachable or unstable page cannot leak the browser process.
export async function openPlaywrightSiteEvidenceBrowser(
 _required: Record<string, never>, options: PlaywrightAdapterOptions = {},
): Promise<SiteEvidenceBrowserAvailability> {
  let playwright: PlaywrightLike;
  try {
    const moduleName = "playwright";
    playwright = options.moduleLoader
      ? await options.moduleLoader.load({ moduleName })
      : (await import(moduleName)) as unknown as PlaywrightLike;
  } catch (error) {
    return {
      available: false,
      reason:
        "the 'playwright' package is not installed in this deployment, so rendered-page behaviour " +
        `cannot be observed here (${messageOf(error)})`,
    };
  }

  let browser: PwBrowser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...options.launchOptions });
  } catch (error) {
    return {
      available: false,
      reason:
        "Chromium could not be launched in this deployment — the 'playwright' package is present but its " +
        `browser binary is not installed (run 'npx playwright install --with-deps chromium'). Underlying error: ${messageOf(error)}`,
    };
  }

  return { available: true, browser: new PlaywrightSiteEvidenceBrowser({ browser }) };
}

class PlaywrightSiteEvidenceBrowser implements SiteEvidenceBrowserPort {
  private readonly browser: PwBrowser;
  constructor({ browser }: { browser: PwBrowser }) { this.browser = browser; }

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
    const budget = new PageWorkBudget({ timeoutMs: request.timeoutMs });
    // No `storageState`, no `recordVideo`, no `recordHar`, no user-data dir: nothing this context
    // observes can outlive `close()` below or reach the filesystem. See this file's header.
    let context: PwContext;
    try {
      context = await budget.run({ work: async () => {
        const created = await this.browser.newContext({ ignoreHTTPSErrors: false });
        // A context can finish opening after our race timed out. It still belongs to this call.
        if (budget.remainingMs() <= 0) {
          void created.close().catch(() => {});
          throw new PageWorkTimeout({ timeoutMs: request.timeoutMs });
        }
        return created;
      } });
    } catch (error) {
      return { ok: false, reason: `page capture failed before load: ${messageOf(error)}` };
    }
    const requests: RequestEvidence[] = [];
    const notes: string[] = [];
    let phase: ObservationPhase = "before";

    try {
      await budget.run({ work: () => context.route("**/*", async (route) => {
        const pending = route.request();
        const method = pending.method().toUpperCase();
        const blocked = !SAFE_METHODS.has(method);

        recordRequest(requests, request, {
          method,
          url: pending.url(),
          resourceType: pending.resourceType(),
          phase,
          ...(blocked
            ? {
                blockedReason:
                  "aborted: this tool never sends a non-GET request, so no form, consent preference, or " +
                  "analytics beacon it observes is ever actually submitted. The attempt itself is the evidence.",
              }
            : {}),
        });

        if (blocked) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      }) });

      const page = await budget.run({ work: () => context.newPage() });

      let response: PwResponse | null;
      try {
        response = await budget.run({ work: () => page.goto(request.url, { waitUntil: "load", timeout: budget.remainingMs() }) });
      } catch (error) {
        return { ok: false, reason: `navigation failed or timed out after ${request.timeoutMs}ms: ${messageOf(error)}` };
      }

      if (response === null) {
        return { ok: false, reason: "the browser produced no response for this navigation (no HTTP exchange to observe)" };
      }

      const finalUrl = response.url();
      const structureLimits: PageStructureLimits = {
        maxTextExcerptChars: request.maxTextExcerptChars,
        maxNodesPerCategory: request.maxAccessibilityNodesPerCategory,
        maxContrastSamples: request.maxContrastSamples,
        collectAccessibility: request.collectAccessibility,
      };

      let structure: PageStructureCapture;
      let cookies: PwCookie[];
      try {
        structure = await budget.run({ work: () => page.evaluate<PageStructureCapture>(buildPageStructureExpression(structureLimits)) });

        if (request.consentAcceptSelector !== undefined) {
          await this.performConsentClick(page, request, notes, () => {
            phase = "after";
          }, budget);
        }

        cookies = await budget.run({ work: () => context.cookies() });
      } catch (error) {
        // The page can navigate away, close, or crash between `goto` resolving above and either of
        // these reads — most commonly surfacing as Playwright's own "Execution context was
        // destroyed". That is exactly the class of failure this port's contract exists to report as
        // `{ ok: false, reason }` rather than let escape as a thrown error: one unreachable/unstable
        // page must not end the whole `site_collect_page_evidence` run (`collect-page-evidence.ts`'s
        // own per-page catch is the second, defense-in-depth layer for a port that does not honor
        // this).
        return { ok: false, reason: `page capture failed after load: ${messageOf(error)}` };
      }

      return {
        ok: true,
        observation: buildObservation({
          request,
          finalUrl,
          httpStatus: response.status(),
          headers: response.headers(),
          title: structure.title,
          structure,
          cookies,
          requests,
          notes,
          consentPhase: phase,
        }),
      };
    } catch (error) {
      return { ok: false, reason: `page capture failed: ${messageOf(error)}` };
    } finally {
      await budget.release({ close: () => context.close() });
    }
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
      matches = await budget.run({ work: () => page.locator(selector).count() });
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
      await budget.run({ work: () => page.locator(selector).first().click({ timeout: Math.min(budget.remainingMs(), 5_000) }) });
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
 * Fails closed (`false`, i.e. treated as third-party) on an unparseable base URL: over-reporting
 * third-party makes a screening noisier, under-reporting it makes a screening wrong.
 */
function sameHost(originBaseUrl: string, hostname: string): boolean {
  try {
    return new URL(originBaseUrl).hostname.toLowerCase() === hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** Strips a single trailing slash so `https://x/pricing` and `https://x/pricing/` do not read as a
 *  redirect. Anything else that differs genuinely is one. */
function normalizeUrlForComparison(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
