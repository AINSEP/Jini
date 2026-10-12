import type { HttpClientPort } from "@jini-ai/core/primitives";
import { createRequestRouter, fetchOwnSiteResource, type FetchedResource, type AbortReason } from "./request-guard.js";
import { renderPage, type RenderSession } from "./render-page.js";
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
  return {
    record({ url, resourceType, resource }: { url: string; resourceType: string; resource: FetchedResource }, _options = {}) {
      if (resourceType !== "xhr" && resourceType !== "fetch") return;
      const contentType = Object.entries(resource.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0]?.trim() ?? "";
      if (!/^(?:application|text)\/(?:json|[\w.+-]+\+json)$/i.test(contentType)) return;
      const capturedUrl = url.slice(0, 2048);
      if (patterns && !patterns.some(pattern => matchesCaptureUrl({ url, pattern }))) {
        if (dataUnmatched.length >= maxResponses || used + capturedUrl.length > totalChars) { truncated = true; return; }
        // Do not decode or charge omitted bodies: noisy providers must not consume the useful body window.
        dataUnmatched.push({ url: capturedUrl, status: resource.status, size: resource.body.length });
        used += capturedUrl.length;
        truncated ||= resource.truncated || url.length > 2048;
        return;
      }
      if (data.length >= maxResponses || used >= totalChars) { truncated = true; return; }
      if (used + capturedUrl.length >= totalChars) { truncated = true; return; }
      const limit = Math.min(perBodyChars, totalChars - used - capturedUrl.length);
      // At most four UTF-8 bytes per output character; never decode a multi-megabyte body here.
      const decoded = resource.body.subarray(0, limit * 4).toString("utf8");
      const body = decoded.slice(0, limit);
      const cut = resource.truncated || resource.body.length > limit * 4 || decoded.length > limit || url.length > 2048;
      used += capturedUrl.length + body.length;
      data.push({ url: capturedUrl, status: resource.status, body, truncated: cut });
      truncated ||= cut;
    },
    markTruncated({ resourceType }: { resourceType: string }, _options = {}) {
      if (resourceType === "xhr" || resourceType === "fetch") truncated = true;
    },
    result: (_required = {}, _options = {}) => ({ data: [...data], dataTruncated: truncated, ...(patterns ? { dataUnmatched: [...dataUnmatched] } : {}) }),
  };
}

/** Self-contained browser script: DOM and computed styles are native browser capabilities.
 * Ships as a string to avoid esbuild's module-scoped __name helper leaking into evaluation.
 * Scans at most 5000 nodes, caps images and every emitted string before crossing the browser port. */
export function publicPageExpression({ maxChars, textMode = "full" }: { maxChars: number; textMode?: PublicPageInput["textMode"] }, _options = {}): string {
  return `(() => {
    const cap = ${maxChars}; const htmlCap = Math.max(4096, cap * 4);
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

/** Anonymous public render using the shared lifecycle and the existing pinned HTTP transport.
 * Import/launch, navigation, selector, extraction and screenshot all share one hard deadline.
 * Owned processes close, shared leases release; late launches are handled without owner storage.
 * @throws Error for unavailable Chromium, refused navigation or deadline exhaustion.
 * @complexity Bounded requests/bytes plus at most 5000 DOM nodes and one viewport screenshot. */
export async function renderPublicPage(
  { input, httpClient }: { input: PublicPageInput; httpClient: HttpClientPort },
  { signal, timeoutMs = 30_000, moduleLoader, browserPool }: { signal?: AbortSignal; timeoutMs?: number; moduleLoader?: PlaywrightAdapterOptions["moduleLoader"]; browserPool?: RenderBrowserPool } = {},
): Promise<PublicPageCapture> {
  timeoutMs = Math.min(timeoutMs, 30_000);
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([abort.signal, deadline, ...(signal ? [signal] : [])]);
  const budget = new PageWorkBudget({ timeoutMs }, { signal: combined });
  let lease: RenderBrowserLease | undefined;
  const opened = await budget.run({ work: async () => {
    if (browserPool) {
      let acquired: RenderBrowserLease;
      try { acquired = await browserPool.acquire({}, { signal: combined }); }
      catch (error) {
        if (combined.aborted || (error as { code?: string })?.code === "WEB_RENDER_BUSY") throw error;
        throw Object.assign(new Error("Headless browser is unavailable in this deployment"), { code: "WEB_RENDER_UNAVAILABLE" });
      }
      if (combined.aborted || budget.remainingMs() <= 0) { acquired.release(); combined.throwIfAborted(); throw new PageWorkTimeout({ timeoutMs }); }
      lease = acquired;
      return { available: true as const, browser: acquired.browser };
    }
    const result = await openPlaywrightRenderBrowser({}, { ...(moduleLoader ? { moduleLoader } : {}), launchOptions: PUBLIC_RENDER_LAUNCH_OPTIONS });
    if (result.available && (budget.remainingMs() <= 0 || combined.aborted)) {
      void result.browser.close().catch(() => {});
      combined.throwIfAborted();
      throw new PageWorkTimeout({ timeoutMs });
    }
    return result;
  } });
  if (!opened.available) throw Object.assign(new Error("Headless browser is unavailable in this deployment"), { code: "WEB_RENDER_UNAVAILABLE" });
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
      if (resourceType !== "xhr" && resourceType !== "fetch") return;
      blockedDataRequests[reason] = (blockedDataRequests[reason] ?? 0) + 1;
      json.markTruncated({ resourceType });
    },
  });
  try {
    return await renderPage({ browser: opened.browser, url: input.url, consume: async ({ page, finalUrl, response, budget: pageBudget }: RenderSession) => {
      const snapshot = await pageBudget.run({ work: async () => await page.evaluate(publicPageExpression({ maxChars: input.maxChars, ...(input.textMode ? { textMode: input.textMode } : {}) })) as Pick<PublicPageCapture, "html" | "text" | "title" | "truncated" | "images" | "imagesTruncated"> });
      let screenshot: PublicPageCapture["screenshot"];
      if (input.screenshot) {
        if (!page.screenshot) throw new Error("Browser cannot take screenshots");
        const jpeg = await pageBudget.run({ work: () => page.screenshot!({ type: "jpeg", quality: 72, fullPage: false, timeout: pageBudget.remainingMs(), animations: "disabled" }) });
        if (jpeg.length <= 2 * 1024 * 1024) screenshot = { mimeType: "image/jpeg", data: jpeg.toString("base64") };
        else snapshot.truncated = true;
      }
      return { ...snapshot, truncated: snapshot.truncated || finalUrl.length > 2048, finalUrl: finalUrl.slice(0, 2048), status: response?.status() ?? 0, ...json.result(), blockedDataRequests: { ...blockedDataRequests }, ...(screenshot ? { screenshot } : {}) };
    } }, {
      originPolicy: "public", router, timeoutMs: budget.remainingMs(), signal: combined,
      ...(input.waitFor === undefined ? {} : { waitFor: input.waitFor }), dismissCookieBanners: input.dismissCookieBanners !== false,
      contextOptions: { viewport: { width: 1280, height: 800 } },
    });
  } finally {
    abort.abort();
    if (lease) lease.release();
    else await budget.release({ close: () => opened.browser.close().catch(() => {}) });
  }
}
