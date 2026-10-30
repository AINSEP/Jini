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
    const origin = new URL(url).origin;
    super(`Off-origin navigation refused: ${origin} is outside the rendered site's origin`);
    this.origin = origin;
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
    if (await clickIfShown({ page, selector, budget })) return true;
  }
  return false;
}

/** One known control: missing, hidden or failing lookups move on; only the page budget ends the search. */
async function clickIfShown({ page, selector, budget }: { page: RenderPage; selector: string; budget: PageWorkBudget }): Promise<boolean> {
  try {
    const locator = page.locator!(selector).first();
    if (await budget.run({ work: () => locator.count() }) === 0) return false;
    if (locator.isVisible && !await budget.run({ work: () => locator.isVisible!() })) return false;
    await budget.run({ work: () => locator.click({ timeout: Math.min(500, budget.remainingMs()) }) });
    return true;
  } catch (error) {
    if (error instanceof PageWorkTimeout) throw error;
    return false;
  }
}

/** Syntax boundary; address/DNS decisions belong exclusively to the pinned request router. */
function assertHttpUrl({ url }: { url: string }, _options = {}): void {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Rendering requires an anonymous http(s) URL");
  }
}

type OriginPolicy = { originPolicy: "same-origin" | "public"; originBaseUrl: string };

function isOffOrigin({ url, originPolicy, originBaseUrl }: OriginPolicy & { url: string }): boolean {
  return originPolicy === "same-origin" && !isSameOriginUrl({ baseUrl: originBaseUrl, candidateUrl: url });
}

/** Every explicit target and the final URL pass the same syntax and origin boundary. */
function assertNavigable(required: OriginPolicy & { url: string }): void {
  assertHttpUrl(required);
  if (isOffOrigin(required)) throw new OffOriginNavigationError(required);
}

/** Only viewport/device settings cross into the fresh context. */
const CONTEXT_OPTION_KEYS = ["viewport", "deviceScaleFactor", "isMobile", "hasTouch", "javaScriptEnabled"];

async function openContext(
  { browser, budget, signal, timeoutMs }: { browser: RenderBrowser; budget: PageWorkBudget; signal: AbortSignal; timeoutMs: number },
  { contextOptions = {} }: RenderPageOptions,
): Promise<RenderContext> {
  return budget.run({ work: async () => {
    const allowed = Object.fromEntries(CONTEXT_OPTION_KEYS.filter(key => contextOptions[key] !== undefined).map(key => [key, contextOptions[key]]));
    // No storageState, recordVideo, recordHar or user-data dir: observed state never reaches disk.
    const opened = await browser.newContext({ ...allowed, ignoreHTTPSErrors: false, serviceWorkers: "block", acceptDownloads: false });
    // A context that opens after cancellation/deadline still belongs to this call.
    if (budget.remainingMs() <= 0 || signal.aborted) {
      void opened.close().catch(() => {});
      signal.throwIfAborted();
      throw new PageWorkTimeout({ timeoutMs });
    }
    return opened;
  } });
}

/** Routes every context request; the returned reader names the origin of a refused main-frame navigation. */
async function guardRequests(
  { context, budget, originPolicy, originBaseUrl }: OriginPolicy & { context: RenderContext; budget: PageWorkBudget },
  { router, onRequest }: RenderPageOptions,
): Promise<() => string | undefined> {
  let refusedOrigin: string | undefined;
  await budget.run({ work: async () => { await context.routeWebSocket?.(/.*/, socket => socket.close().catch(() => {})); } });
  await budget.run({ work: () => context.route("**/*", async route => {
    const pending = route.request();
    const offOrigin = isMainFrameNavigation({ request: pending }) && isOffOrigin({ url: pending.url(), originPolicy, originBaseUrl });
    if (offOrigin) refusedOrigin = new URL(pending.url()).origin;
    // Public data methods belong to the router; evidence always refuses writes first.
    // (Public mode always has a router: renderPage refuses public rendering without one.)
    const blocked = offOrigin || (originPolicy !== "public" && !["GET", "HEAD"].includes(pending.method().toUpperCase()));
    const markBlocked = onRequest?.({ route, blocked });
    if (blocked) {
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    if (router) {
      await routeThroughRouter({ router, route }, { markBlocked });
      return;
    }
    // Trusted own-origin evidence retains browser cookies, but never posts preferences or forms.
    if (!route.continue) throw new Error("Own-origin browser route cannot continue: the route port has no continue()");
    await route.continue();
  }) });
  return () => refusedOrigin;
}

function routeThroughRouter(
  { router, route }: { router: RequestRouter; route: RouteLike },
  { markBlocked }: { markBlocked?: void | ((required: { reason: string }) => void) },
): Promise<void> {
  const pending = route.request();
  return router.handle({
    request: () => pending, fulfill: options => route.fulfill(options),
    abort: async code => {
      // Redirect aborts are navigation control, not a refused network observation.
      if (code !== "aborted" && typeof markBlocked === "function") markBlocked({ reason: "aborted by the guarded browser request router (unsafe target, unsupported request or resource cap)" });
      await route.abort(code);
    },
  });
}

/** Explicit gotos only: a router-recorded main-frame redirect is vetted and navigated as a new hop. */
async function navigate(
  { page, budget, url, refusedOrigin, ...policy }: OriginPolicy & { page: RenderPage; budget: PageWorkBudget; url: string; refusedOrigin: () => string | undefined },
  options: RenderPageOptions,
): Promise<{ target: string; response: RenderResponse | null }> {
  for (let hop = 0, target = url; ; hop += 1) {
    assertNavigable({ url: target, ...policy });
    try {
      return { target, response: await budget.run({ work: () => page.goto(target, { waitUntil: "domcontentloaded", timeout: budget.remainingMs() }) }) };
    } catch (error) {
      target = nextHopAfterFailedGoto({ error, hop, target, refusedOrigin: refusedOrigin() }, options);
    }
  }
}

/** A failed goto is a refused origin, a recorded redirect to follow, a guard refusal, or the browser's own error. */
function nextHopAfterFailedGoto(
  { error, hop, target, refusedOrigin }: { error: unknown; hop: number; target: string; refusedOrigin: string | undefined },
  { router }: RenderPageOptions,
): string {
  if (refusedOrigin) throw new OffOriginNavigationError({ url: refusedOrigin });
  const next = router?.takeNavigationRedirect();
  if (next !== undefined && hop < MAX_REDIRECT_HOPS) return next;
  if (router?.report().navigationRefused) throw new RenderRequestRefused({});
  if (next !== undefined) {
    throw new Error(`Rendering stopped: ${new URL(target).origin} kept redirecting past the ${MAX_REDIRECT_HOPS}-hop limit`, { cause: error });
  }
  throw error;
}

/** A selector waits until visible; a number is a settle delay in seconds (zero or less waits for nothing). */
async function waitForSelectorOrDelay({ page, budget, waitFor }: { page: RenderPage; budget: PageWorkBudget; waitFor: string | number }): Promise<void> {
  if (typeof waitFor === "number") {
    if (waitFor > 0) await budget.run({ work: () => page.waitForTimeout(waitFor * 1000) });
    return;
  }
  if (!page.waitForSelector) throw new Error(`Rendering cannot wait for selector "${waitFor}": this browser port has no waitForSelector`);
  await budget.run({ work: () => page.waitForSelector!(waitFor, { state: "visible", timeout: budget.remainingMs() }) });
}

/** Cookie dismissal, the selector/settle strategy and the best-effort load wait, all within the page budget. */
async function settlePage(
  { page, budget, signal }: { page: RenderPage; budget: PageWorkBudget; signal: AbortSignal },
  options: RenderPageOptions,
): Promise<void> {
  const { waitFor = 1.2, dismissCookieBanners: dismiss = false } = options;
  const dismissed = dismiss && await dismissCookieBanners({ page, budget });
  await waitForSelectorOrDelay({ page, budget, waitFor });
  await waitForLoad({ page, budget, signal }, options);
  // Hydrated consent widgets can arrive during the settle/selector wait.
  if (dismiss && !dismissed && await dismissCookieBanners({ page, budget })) {
    await budget.run({ work: () => page.waitForTimeout(200) });
  }
}

async function waitForLoad({ page, budget, signal }: { page: RenderPage; budget: PageWorkBudget; signal: AbortSignal }, { loadWaitMs }: RenderPageOptions): Promise<void> {
  if (!loadWaitMs || !page.waitForLoadState) return;
  try {
    await budget.run({ work: () => page.waitForLoadState!("load", { timeout: Math.min(loadWaitMs, budget.remainingMs()) }) });
  } catch (error) {
    if (error instanceof PageWorkTimeout || signal.aborted) throw error;
    // A polling or slow resource must not prevent bounded best-effort evidence/capture.
  }
}

/** Guard, navigate and settle the page; the session's final URL passes the same origin boundary. */
async function openSession(
  { context, budget, signal, url }: { context: RenderContext; budget: PageWorkBudget; signal: AbortSignal; url: string },
  options: RenderPageOptions,
): Promise<RenderSession> {
  const policy: OriginPolicy = { originPolicy: options.originPolicy ?? "same-origin", originBaseUrl: options.originBaseUrl ?? url };
  const refusedOrigin = await guardRequests({ context, budget, ...policy }, options);
  const page = await budget.run({ work: () => context.newPage() });
  const { target, response } = await navigate({ page, budget, url, refusedOrigin, ...policy }, options);
  await settlePage({ page, budget, signal }, options);
  signal.throwIfAborted();
  const finalUrl = page.url?.() ?? response?.url?.() ?? target;
  assertNavigable({ url: finalUrl, ...policy });
  return { page, context, response, finalUrl, budget };
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
  const { timeoutMs = 30_000, signal: callerSignal } = options;
  assertHttpUrl({ url });
  if (options.originPolicy === "public" && !options.router) throw new Error("Public rendering requires a guarded request router");
  // A native total timer remains firm even if the wall clock moves between budgeted steps.
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  try {
    return await consumeOnePage({ browser, url, consume, signal, timeoutMs }, options);
  } catch (error) {
    if (deadline.aborted && !callerSignal?.aborted) throw new PageWorkTimeout({ timeoutMs });
    throw error;
  }
}

/** The context opened here is closed at once on abort and always released when the call ends. */
async function consumeOnePage<T>(
  { browser, url, consume, signal, timeoutMs }: { browser: RenderBrowser; url: string; consume: (session: RenderSession) => Promise<T>; signal: AbortSignal; timeoutMs: number },
  options: RenderPageOptions,
): Promise<T> {
  const budget = new PageWorkBudget({ timeoutMs }, { signal });
  let context: RenderContext | undefined;
  const onAbort = () => { void context?.close().catch(() => {}); };
  signal.throwIfAborted();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    context = await openContext({ browser, budget, signal, timeoutMs }, options);
    const session = await openSession({ context, budget, signal, url }, options);
    return await budget.run({ work: () => consume(session) });
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (context) await budget.release({ close: () => context!.close().catch(() => {}) });
  }
}
