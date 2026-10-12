import { PageWorkBudget, PageWorkTimeout } from "./page-work-budget.js";
import { isSameOriginUrl } from "./same-origin.js";
import { MAX_REDIRECT_HOPS, isMainFrameNavigation, type RequestRouter, type RouteLike } from "./request-guard.js";

/** Structural browser ports shared by evidence, public reading and screenshots. No vendor SDK. */
export interface RenderResponse { status(): number; url?(): string; headers?(): Record<string, string> }
export interface RenderLocator {
  first(): RenderLocator;
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
  isVisible?(): Promise<boolean>;
}
export interface RenderPage {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<RenderResponse | null>;
  evaluate(expression: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState?(state: "load", options: { timeout: number }): Promise<void>;
  waitForSelector?(selector: string, options: { state: "visible"; timeout: number }): Promise<unknown>;
  locator?(selector: string): RenderLocator;
  title(): Promise<string>;
  url?(): string;
  screenshot?(options: { type: "png" | "jpeg"; quality?: number; fullPage: boolean; clip?: { x: number; y: number; width: number; height: number }; timeout: number; animations: "disabled" }): Promise<Buffer>;
}
export interface RenderCookie {
  name: string; value: string; domain: string; path: string; expires: number;
  httpOnly: boolean; secure: boolean; sameSite: string;
}
export interface RenderContext {
  newPage(): Promise<RenderPage>;
  route(pattern: string, handler: (route: RouteLike & { continue?(): Promise<void> }) => Promise<void>): Promise<unknown>;
  routeWebSocket?(pattern: RegExp, handler: (socket: { close(): Promise<void> }) => unknown): Promise<unknown>;
  cookies?(): Promise<RenderCookie[]>;
  close(): Promise<void>;
}
export interface RenderBrowser {
  newContext(options?: Record<string, unknown>): Promise<RenderContext>;
  close(): Promise<void>;
}
export interface RenderSession {
  page: RenderPage; context: RenderContext; response: RenderResponse | null;
  finalUrl: string; budget: PageWorkBudget;
}
export interface RenderPageOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** CSS selector, or settle seconds (0–10). DOM content loaded always precedes this. */
  waitFor?: string | number;
  dismissCookieBanners?: boolean;
  /** Best-effort load wait after the settle/selector strategy, capped within the total deadline. */
  loadWaitMs?: number;
  /** Same-origin navigation is the default. Public mode requires a pinned-transport router. */
  originPolicy?: "same-origin" | "public";
  originBaseUrl?: string;
  /** Only viewport/device settings cross this boundary; saved storage/credentials are discarded. */
  contextOptions?: Record<string, unknown>;
  router?: RequestRouter;
  /** Observe the attempt immediately; an optional returned hook records a later guard refusal. */
  onRequest?: (required: { route: RouteLike; blocked: boolean }) => void | ((required: { reason: string }) => void);
}

/** Stable safe code for a renderer behind a port; no resolved peer or target path is exposed. */
export class RenderRequestRefused extends Error {
  readonly code = "WEB_RENDER_REFUSED";
  constructor(_required: Record<string, never>, _options = {}) { super("Navigation refused by the egress guard"); }
}

/** Origin-only refusal metadata lets collectors retain their existing off-origin skip result. */
export class OffOriginNavigationError extends Error {
  readonly origin: string;
  constructor({ url }: { url: string }) {
    super("Off-origin navigation refused");
    this.origin = new URL(url).origin;
  }
}

/** Narrow known consent controls: never click a generic page-wide 'close' or 'accept' button. */
export const COOKIE_DISMISS_SELECTORS = [
  "#onetrust-accept-btn-handler", "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "button#cookie-accept", "button[aria-label='Accept cookies']", "button[aria-label='Accept all cookies']",
  "[role='dialog']:has-text('cookie') button:has-text('Accept all')",
  "[role='dialog']:has-text('cookie') button[aria-label='Close']",
  "[id*='cookie'] button:has-text('Accept')", "[class*='cookie'] button:has-text('Accept all')",
  "#onetrust-close-btn-container button", "[id*='cookie'] button[aria-label='Close']", "[class*='cookie'] button[aria-label='Close']",
] as const;

/** Click the first visible known cookie control; absence or a disappearing banner is harmless.
 * @complexity O(k), k is the fixed selector list; clicks use the same total page budget. */
export async function dismissCookieBanners({ page, budget }: { page: RenderPage; budget: PageWorkBudget }, _options = {}): Promise<boolean> {
  if (!page.locator) return false;
  for (const selector of COOKIE_DISMISS_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if (await budget.run({ work: () => locator.count() }) === 0) continue;
      if (locator.isVisible && !await budget.run({ work: () => locator.isVisible!() })) continue;
      await budget.run({ work: () => locator.click({ timeout: Math.min(500, budget.remainingMs()) }) });
      return true;
    } catch (error) {
      if (error instanceof PageWorkTimeout) throw error;
    }
  }
  return false;
}

/** Syntax boundary; address/DNS decisions belong exclusively to the pinned request router. */
function assertHttpUrl({ url }: { url: string }, _options = {}): void {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Rendering requires an anonymous http(s) URL");
  }
}

/** Open, guard, wait and consume ONE ephemeral page, always releasing the context.
 * No network-idle wait: SPAs and polling sites can stay busy forever. DNS decisions are not followed
 * by Chromium `continue()` in public mode: the router fetches on pinned vetted peers and fulfills
 * responses; a dead proxy at launch prevents unrouted protocols from escaping.
 * A fulfilled 3xx is never handed to Chromium: Playwright does not route its next hop. The router
 * aborts a main-frame redirect and records its target, so each explicit goto is vetted again.
 * @throws Browser errors, cancellation, PageWorkTimeout, or a refused origin/transport boundary.
 * @complexity Bounded page I/O plus the consumer; at most six explicit navigation hops. */
export async function renderPage<T>(
  { browser, url, consume }: { browser: RenderBrowser; url: string; consume: (session: RenderSession) => Promise<T> },
  options: RenderPageOptions = {},
): Promise<T> {
  const { timeoutMs = 30_000, signal: callerSignal, waitFor = 1.2, originPolicy = "same-origin", originBaseUrl = url, router } = options;
  assertHttpUrl({ url });
  if (originPolicy === "public" && !router) throw new Error("Public rendering requires a guarded request router");
  // A native total timer remains firm even if the wall clock moves between budgeted steps.
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  const budget = new PageWorkBudget({ timeoutMs }, { signal });
  let context: RenderContext | undefined;
  const onAbort = () => { void context?.close().catch(() => {}); };
  signal?.throwIfAborted();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    context = await budget.run({ work: async () => {
      const supplied = options.contextOptions ?? {};
      const contextOptions = Object.fromEntries(["viewport", "deviceScaleFactor", "isMobile", "hasTouch", "javaScriptEnabled"].filter(key => supplied[key] !== undefined).map(key => [key, supplied[key]]));
      // No storageState, recordVideo, recordHar or user-data dir: observed state never reaches disk.
      const opened = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors: false, serviceWorkers: "block", acceptDownloads: false });
      // A context that opens after cancellation/deadline still belongs to this call.
      if (budget.remainingMs() <= 0 || signal?.aborted) {
        void opened.close().catch(() => {});
        signal?.throwIfAborted();
        throw new PageWorkTimeout({ timeoutMs });
      }
      return opened;
    } });
    const active = context;
    await budget.run({ work: async () => { await active.routeWebSocket?.(/.*/, socket => socket.close().catch(() => {})); } });
    let refusedOrigin: string | undefined;
    await budget.run({ work: async () => { await active.route("**/*", async route => {
      const pending = route.request();
      const navigation = isMainFrameNavigation({ request: pending });
      const offOrigin = originPolicy === "same-origin" && navigation && !isSameOriginUrl({ baseUrl: originBaseUrl, candidateUrl: pending.url() });
      if (offOrigin && navigation) refusedOrigin = new URL(pending.url()).origin;
      // Public data methods belong to the router; evidence always refuses writes first.
      const blocked = offOrigin || ((originPolicy !== "public" || !router) && !["GET", "HEAD"].includes(pending.method().toUpperCase()));
      const markBlocked = options.onRequest?.({ route, blocked });
      if (blocked) { await route.abort("blockedbyclient").catch(() => {}); return; }
      if (router) {
        await router.handle({
          request: () => pending, fulfill: options => route.fulfill(options),
          abort: async code => {
            // Redirect aborts are navigation control, not a refused network observation.
            if (code !== "aborted" && typeof markBlocked === "function") markBlocked({ reason: "aborted by the guarded browser request router (unsafe target, unsupported request or resource cap)" });
            await route.abort(code);
          },
        });
        return;
      }
      // Trusted own-origin evidence retains browser cookies, but never posts preferences or forms.
      if (!route.continue) throw new Error("Own-origin browser route cannot continue");
      await route.continue();
    }); } });
    const page = await budget.run({ work: () => active.newPage() });
    let target = url;
    let response: RenderResponse | null = null;
    for (let hop = 0; ; hop += 1) {
      assertHttpUrl({ url: target });
      if (originPolicy === "same-origin" && !isSameOriginUrl({ baseUrl: originBaseUrl, candidateUrl: target })) throw new OffOriginNavigationError({ url: target });
      try {
        response = await budget.run({ work: () => page.goto(target, { waitUntil: "domcontentloaded", timeout: budget.remainingMs() }) });
        break;
      } catch (error) {
        if (refusedOrigin) throw new OffOriginNavigationError({ url: refusedOrigin });
        const next = router?.takeNavigationRedirect();
        if (next !== undefined && hop < MAX_REDIRECT_HOPS) { target = next; continue; }
        if (router?.report().navigationRefused) throw new RenderRequestRefused({});
        if (next !== undefined) throw new Error("too many redirects");
        throw error;
      }
    }
    const dismissed = options.dismissCookieBanners ? await dismissCookieBanners({ page, budget }) : false;
    if (typeof waitFor === "string") {
      if (!page.waitForSelector) throw new Error("Browser does not support selector waits");
      await budget.run({ work: () => page.waitForSelector!(waitFor, { state: "visible", timeout: budget.remainingMs() }) });
    } else if (waitFor > 0) {
      await budget.run({ work: () => page.waitForTimeout(waitFor * 1000) });
    }
    if (options.loadWaitMs && page.waitForLoadState) {
      try {
        await budget.run({ work: () => page.waitForLoadState!("load", { timeout: Math.min(options.loadWaitMs!, budget.remainingMs()) }) });
      } catch (error) {
        if (error instanceof PageWorkTimeout || signal.aborted) throw error;
        // A polling or slow resource must not prevent bounded best-effort evidence/capture.
      }
    }
    // Hydrated consent widgets can arrive during the settle/selector wait.
    if (options.dismissCookieBanners && !dismissed && await dismissCookieBanners({ page, budget })) {
      await budget.run({ work: () => page.waitForTimeout(200) });
    }
    signal?.throwIfAborted();
    const finalUrl = page.url?.() ?? response?.url?.() ?? target;
    assertHttpUrl({ url: finalUrl });
    if (originPolicy === "same-origin" && !isSameOriginUrl({ baseUrl: originBaseUrl, candidateUrl: finalUrl })) throw new OffOriginNavigationError({ url: finalUrl });
    return await budget.run({ work: () => consume({ page, context: active, response, finalUrl, budget }) });
  } catch (error) {
    if (deadline.aborted && !callerSignal?.aborted) throw new PageWorkTimeout({ timeoutMs });
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (context) await budget.release({ close: () => context!.close().catch(() => {}) });
  }
}
