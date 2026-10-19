import type { HttpClientPort } from "@jini-ai/core/primitives";
import { createRequestRouter, fetchOwnSiteResource, type FetchedResource, type AbortReason } from "./request-guard.js";
import { renderPage, type RenderBrowser, type RenderSession } from "./render-page.js";
import { openPlaywrightRenderBrowser, PUBLIC_RENDER_LAUNCH_OPTIONS, type PlaywrightAdapterOptions } from "./playwright-runtime.js";
import type { RenderBrowserPool, RenderBrowserLease } from "./lazy-browser.js";
import { PageWorkBudget, PageWorkTimeout } from "./page-work-budget.js";

export interface CapturedJsonResponse { url: string; status: number; body: string; truncated: boolean }
/** A deliberately omitted JSON body; size is the byte count observed by the bounded transport. */
export interface UnmatchedJsonResponse { url: string; status: number; size: number }
export interface PublicPageInput {
  url: string; maxChars: number; waitFor?: string | number; dismissCookieBanners?: boolean; captureData?: boolean; screenshot?: boolean;
  /** URL substrings, or full-URL globs with `*` matching any characters; alternatives are ORed. */
  captureDataMatch?: string | string[];
  /** Full text by default, no text, or a leading visible-text excerpt of at most 1000 characters. */
  textMode?: "full" | "none" | "summary";
}
export interface PublicPageCapture {
  finalUrl: string; status: number; title: string; html: string; text: string; truncated: boolean;
  images: Array<{ src: string; alt: string }>; imagesTruncated: boolean;
  data: CapturedJsonResponse[]; dataTruncated: boolean;
  dataUnmatched?: UnmatchedJsonResponse[];
  blockedDataRequests: Partial<Record<AbortReason, number>>;
  screenshot?: { mimeType: "image/jpeg"; data: string };
}

/** Match a literal substring or an anchored `*` glob using native string searches.
 * Other characters (including URL query `?`) are literal. No regex backtracking on untrusted URLs.
 * @complexity O(s × u), s is the pattern's segment count and u the URL length; O(pattern length) space. */
function matchesCaptureUrl({ url, pattern }: { url: string; pattern: string }, _options = {}): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return url.includes(pattern);
  const prefix = parts[0]!;
  const suffix = parts[parts.length - 1]!;
  if (!url.startsWith(prefix) || !url.endsWith(suffix)) return false;
  let offset = prefix.length;
  const end = url.length - suffix.length;
  for (const part of parts.slice(1, -1)) {
    const found = url.indexOf(part, offset);
    if (found < 0 || found + part.length > end) return false;
    offset = found + part.length;
  }
  return offset <= end;
}

/** Only script-issued data answers are captured or counted; documents, images and scripts are not. */
function isDataResource(resourceType: string): boolean {
  return resourceType === "xhr" || resourceType === "fetch";
}

function isJsonResponse(headers: Readonly<Record<string, string>>): boolean {
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0]?.trim() ?? "";
  return /^(?:application|text)\/(?:json|[\w.+-]+\+json)$/i.test(contentType);
}

/** Bounded synchronous collector over responses already read by the pinned request router.
 * No response.body() listener: it would read whole untrusted bodies before applying the cap.
 * Filters affect output only: unmatched data still reaches the page so hydration can complete.
 * Matched and unmatched lists each cap their count; both charge URLs to the shared character budget.
 * @example createJsonCapture({}, { captureDataMatch: "/v1/datasource/" })
 * @complexity URL matching plus O(min(body, perBodyChars)) per JSON answer; O(totalChars + count) retained space. */
export function createJsonCapture(_required: Record<string, never>, { maxResponses = 20, perBodyChars = 8000, totalChars = 60_000, captureDataMatch }: { maxResponses?: number; perBodyChars?: number; totalChars?: number; captureDataMatch?: string | string[] } = {}) {
  const data: CapturedJsonResponse[] = [];
  const dataUnmatched: UnmatchedJsonResponse[] = [];
  const patterns = typeof captureDataMatch === "string" ? [captureDataMatch] : captureDataMatch;
  let used = 0;
  let truncated = false;

  function recordUnmatched({ url, capturedUrl, resource }: { url: string; capturedUrl: string; resource: FetchedResource }): void {
    if (dataUnmatched.length >= maxResponses || used + capturedUrl.length > totalChars) { truncated = true; return; }
    // Do not decode or charge omitted bodies: noisy providers must not consume the useful body window.
    dataUnmatched.push({ url: capturedUrl, status: resource.status, size: resource.body.length });
    used += capturedUrl.length;
    truncated ||= resource.truncated || url.length > 2048;
  }

  function recordMatched({ url, capturedUrl, resource }: { url: string; capturedUrl: string; resource: FetchedResource }): void {
    if (data.length >= maxResponses || used + capturedUrl.length >= totalChars) { truncated = true; return; }
    const limit = Math.min(perBodyChars, totalChars - used - capturedUrl.length);
    // At most four UTF-8 bytes per output character; never decode a multi-megabyte body here.
    const decoded = resource.body.subarray(0, limit * 4).toString("utf8");
    const body = decoded.slice(0, limit);
    const cut = resource.truncated || resource.body.length > limit * 4 || decoded.length > limit || url.length > 2048;
    used += capturedUrl.length + body.length;
    data.push({ url: capturedUrl, status: resource.status, body, truncated: cut });
    truncated ||= cut;
  }

  return {
    record({ url, resourceType, resource }: { url: string; resourceType: string; resource: FetchedResource }, _options = {}) {
      if (!isDataResource(resourceType) || !isJsonResponse(resource.headers)) return;
      const capturedUrl = url.slice(0, 2048);
      if (patterns && !patterns.some(pattern => matchesCaptureUrl({ url, pattern }))) recordUnmatched({ url, capturedUrl, resource });
      else recordMatched({ url, capturedUrl, resource });
    },
    markTruncated({ resourceType }: { resourceType: string }, _options = {}) {
      if (isDataResource(resourceType)) truncated = true;
    },
    result: (_required = {}, _options = {}) => ({ data: [...data], dataTruncated: truncated, ...(patterns ? { dataUnmatched: [...dataUnmatched] } : {}) }),
  };
}

/** Self-contained browser script: DOM and computed styles are native browser capabilities.
 * Ships as a string to avoid esbuild's module-scoped __name helper leaking into evaluation.
 * HTML has a fixed transport cap so a large style head cannot consume the readable-text budget.
 * Scans at most 5000 nodes, caps images and every emitted string before crossing the browser port. */
export function publicPageExpression({ maxChars, textMode = "full" }: { maxChars: number; textMode?: PublicPageInput["textMode"] }, _options = {}): string {
  return `(() => {
    const cap = ${maxChars}; const htmlCap = 1_000_000;
    const mode = ${JSON.stringify(textMode)}; const textCap = mode === 'summary' ? Math.min(1000, cap) : cap;
    const images = []; const seen = new Set(); let imagesTruncated = false;
    const add = (raw, alt) => {
      if (!raw) return;
      let u; try { u = new URL(raw, document.baseURI); } catch { return; }
      if (!['http:', 'https:'].includes(u.protocol) || seen.has(u.href)) return;
      seen.add(u.href);
      if (images.length >= 300 || u.href.length > 2048) { imagesTruncated = true; return; }
      images.push({src: u.href, alt: (alt || '').slice(0, 300)});
    };
    const copy = document.documentElement.cloneNode(true);
    const originals = document.documentElement.querySelectorAll('*');
    const clones = copy.querySelectorAll('*');
    let scanTruncated = originals.length > 5000;
    for (let i = 0; i < Math.min(originals.length, 5000); i++) {
      const node = originals[i]; const clone = clones[i];
      if (['SCRIPT','NOSCRIPT','TEMPLATE'].includes(node.tagName)) { clone.remove(); continue; }
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        if (!node.closest('head')) clone.remove();
        continue;
      }
      if (node.tagName === 'IMG') { add(node.currentSrc, node.alt); add(node.src, node.alt); add(node.getAttribute('data-src'), node.alt); }
      if (node.tagName === 'IMG' || node.tagName === 'SOURCE') {
        for (const candidate of (node.getAttribute('srcset') || '').split(',')) add(candidate.trim().split(/\\s+/)[0], node.alt);
      }
      for (const match of style.backgroundImage.matchAll(/url\\(['"]?([^'"\\)]+)['"]?\\)/g)) add(match[1], '');
    }
    copy.querySelectorAll('script,noscript,template').forEach(node => node.remove());
    const html = copy.outerHTML; const text = mode !== 'none' && document.body ? document.body.innerText : '';
    const split = text.charCodeAt(textCap);
    const textEnd = mode === 'summary' && split >= 0xDC00 && split <= 0xDFFF ? textCap - 1 : textCap;
    return {html: html.slice(0, htmlCap), text: text.slice(0, textEnd), title: document.title.slice(0, 300),
      images, imagesTruncated: imagesTruncated || scanTruncated,
      truncated: scanTruncated || html.length > htmlCap || text.length > textCap};
  })()`;
}

type OpenedBrowser = { browser: RenderBrowser; lease?: RenderBrowserLease };

function browserUnavailable(options: ErrorOptions = {}): Error {
  return Object.assign(new Error("Headless browser is unavailable in this deployment", options), { code: "WEB_RENDER_UNAVAILABLE" });
}

/** A lease that arrives after cancellation or the deadline is handed straight back. */
async function leaseFromPool(
  { browserPool, signal, budget, timeoutMs }: { browserPool: RenderBrowserPool; signal: AbortSignal; budget: PageWorkBudget; timeoutMs: number },
): Promise<OpenedBrowser> {
  let acquired: RenderBrowserLease;
  try { acquired = await browserPool.acquire({}, { signal }); }
  catch (error) {
    if (signal.aborted || (error as { code?: string })?.code === "WEB_RENDER_BUSY") throw error;
    throw browserUnavailable({ cause: error });
  }
  if (signal.aborted || budget.remainingMs() <= 0) { acquired.release(); signal.throwIfAborted(); throw new PageWorkTimeout({ timeoutMs }); }
  return { browser: acquired.browser, lease: acquired };
}

/** An owned launch that completes after cancellation or the deadline is closed, never leaked. */
async function launchOwnBrowser(
  { signal, budget, timeoutMs }: { signal: AbortSignal; budget: PageWorkBudget; timeoutMs: number },
  launch: Pick<PlaywrightAdapterOptions, "moduleLoader">,
): Promise<OpenedBrowser> {
  const result = await openPlaywrightRenderBrowser({}, { ...launch, launchOptions: PUBLIC_RENDER_LAUNCH_OPTIONS });
  if (!result.available) throw browserUnavailable();
  if (budget.remainingMs() <= 0 || signal.aborted) {
    void result.browser.close().catch(() => {});
    signal.throwIfAborted();
    throw new PageWorkTimeout({ timeoutMs });
  }
  return { browser: result.browser };
}

/** Evaluates the page script and takes the optional bounded screenshot inside the page budget. */
async function capturePage(
  { session: { page, finalUrl, response, budget }, input }: { session: RenderSession; input: PublicPageInput },
): Promise<Omit<PublicPageCapture, "data" | "dataTruncated" | "dataUnmatched" | "blockedDataRequests">> {
  const snapshot = await budget.run({ work: async () => await page.evaluate(publicPageExpression({ maxChars: input.maxChars, ...(input.textMode ? { textMode: input.textMode } : {}) })) as Pick<PublicPageCapture, "html" | "text" | "title" | "truncated" | "images" | "imagesTruncated"> });
  const jpeg = input.screenshot ? await takeScreenshot({ page, budget }) : undefined;
  const screenshot = jpeg && jpeg.length <= 2 * 1024 * 1024 ? { mimeType: "image/jpeg" as const, data: jpeg.toString("base64") } : undefined;
  const truncated = snapshot.truncated || (jpeg !== undefined && !screenshot) || finalUrl.length > 2048;
  return { ...snapshot, truncated, finalUrl: finalUrl.slice(0, 2048), status: response?.status() ?? 0, ...(screenshot ? { screenshot } : {}) };
}

async function takeScreenshot({ page, budget }: Pick<RenderSession, "page" | "budget">): Promise<Buffer> {
  if (!page.screenshot) throw new Error("Public render cannot take the requested screenshot: this browser port has no screenshot()");
  return budget.run({ work: () => page.screenshot!({ type: "jpeg", quality: 72, fullPage: false, timeout: budget.remainingMs(), animations: "disabled" }) });
}

/** Anonymous public render using the shared lifecycle and the existing pinned HTTP transport.
 * Import/launch, navigation, selector, extraction and screenshot all share one hard deadline.
 * Owned processes close, shared leases release; late launches are handled without owner storage.
 * @throws Error for unavailable Chromium, refused navigation or deadline exhaustion.
 * @complexity Bounded requests/bytes plus at most 5000 DOM nodes and one viewport screenshot. */
export async function renderPublicPage(
  { input, httpClient }: { input: PublicPageInput; httpClient: HttpClientPort },
  { signal, timeoutMs: requestedMs = 30_000, browserPool, ...launch }: { signal?: AbortSignal; timeoutMs?: number; browserPool?: RenderBrowserPool } & Pick<PlaywrightAdapterOptions, "moduleLoader"> = {},
): Promise<PublicPageCapture> {
  const timeoutMs = Math.min(requestedMs, 30_000);
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([abort.signal, deadline, ...(signal ? [signal] : [])]);
  const budget = new PageWorkBudget({ timeoutMs }, { signal: combined });
  const opened = await budget.run({ work: () => browserPool
    ? leaseFromPool({ browserPool, signal: combined, budget, timeoutMs })
    : launchOwnBrowser({ signal: combined, budget, timeoutMs }, launch) });
  // Small/batched reads keep their JSON window small too; a batch must not multiply 60k by default.
  const json = createJsonCapture({}, { perBodyChars: Math.min(8000, input.maxChars), totalChars: Math.min(60_000, input.maxChars),
    ...(input.captureDataMatch === undefined ? {} : { captureDataMatch: input.captureDataMatch }),
  });
  const blockedDataRequests: Partial<Record<AbortReason, number>> = {};
  const router = createRequestRouter({ httpClient, ownSiteFetch: fetchOwnSiteResource, allowedOrigins: [], signal: combined }, {
    maxResourceBytes: 5 * 1024 * 1024, maxTotalBytes: 30 * 1024 * 1024, maxRequests: 200,
    allowDataRequests: true,
    ...(input.captureData === false ? {} : { onResponse: json.record }),
    onBlocked: ({ resourceType, reason }) => {
      if (!isDataResource(resourceType)) return;
      blockedDataRequests[reason] = (blockedDataRequests[reason] ?? 0) + 1;
      json.markTruncated({ resourceType });
    },
  });
  try {
    return await renderPage({ browser: opened.browser, url: input.url, consume: async session => {
      const { screenshot, ...captured } = await capturePage({ session, input });
      return { ...captured, ...json.result(), blockedDataRequests: { ...blockedDataRequests }, ...(screenshot ? { screenshot } : {}) };
    } }, {
      originPolicy: "public", router, timeoutMs: budget.remainingMs(), signal: combined,
      ...(input.waitFor === undefined ? {} : { waitFor: input.waitFor }), dismissCookieBanners: input.dismissCookieBanners !== false,
      contextOptions: { viewport: { width: 1280, height: 800 } },
    });
  } finally {
    abort.abort();
    if (opened.lease) opened.lease.release();
    else await budget.release({ close: () => opened.browser.close().catch(() => {}) });
  }
}
