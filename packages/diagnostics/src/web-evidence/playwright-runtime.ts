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
 * {@link PlaywrightLike} and render-page.ts declare, structurally, the browser members this adapter uses.
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
 * These evidence privacy rules describe SiteEvidenceBrowserPort; public-page.ts separately
 * captures explicitly requested, bounded JSON response bodies, without cookies/credentials.
 * - **Values are never read.** Cookie values, request bodies, and form-field values are not
 *   extracted anywhere below, because `browser-port.ts`'s shapes have nowhere to put them.
 */
import type { RenderBrowser } from "./render-page.js";
import type { RequestRouter } from "./request-guard.js";

export interface PlaywrightLike {
  chromium: {
    launch(options?: { headless?: boolean; args?: readonly string[]; chromiumSandbox?: boolean }): Promise<RenderBrowser>;
  };
}

/**
 * Opens a real Chromium for the shared render/evidence adapters, or explains why this
 * deployment cannot.
 *
 * @returns `{ available: true, browser }` on success; `{ available: false, reason }` when the
 * `playwright` module or its Chromium binary is not present. Never throws for either case — see
 * this file's header for why an absent browser must be a reportable state rather than an error.
 * @complexity One process launch. The caller is responsible for calling `close()`, which
 * `collectPageEvidence` does in a `finally`.
 */
export interface PlaywrightAdapterOptions {
 /** Host pinned HTTP router. Own-origin captures alone may preserve fresh visitor cookies. */
 readonly routerFactory?: (required: { originBaseUrl: string; signal: AbortSignal }) => RequestRouter;
 readonly moduleLoader?: { load(required: { moduleName: string }): Promise<PlaywrightLike> };
 readonly launchOptions?: { headless?: boolean; args?: string[]; chromiumSandbox?: boolean };
}

/** Default {@link PlaywrightAdapterOptions.moduleLoader}: a real dynamic import by module name, wired
 * here at the composition edge so the optional `playwright` dependency is only resolved on use. */
export const nodeModuleLoader: NonNullable<PlaywrightAdapterOptions["moduleLoader"]> = {
  load: async ({ moduleName }) => (await import(moduleName)) as unknown as PlaywrightLike,
};

/** Opens the optional browser capability; import and launch failures become availability results. */
// A successful launch transfers process ownership to the caller; close the browser in a finally
// block so an unreachable or unstable page cannot leak the browser process.
export async function openPlaywrightRenderBrowser(
 _required: Record<string, never>, options: PlaywrightAdapterOptions = {},
): Promise<{ available: true; browser: RenderBrowser } | { available: false; reason: string }> {
  let playwright: PlaywrightLike;
  const { moduleLoader = nodeModuleLoader } = options;
  try {
    playwright = await moduleLoader.load({ moduleName: "playwright" });
  } catch (error) {
    return {
      available: false,
      reason:
        "the 'playwright' package is not installed in this deployment, so rendered-page behaviour " +
        `cannot be observed here (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  let browser: RenderBrowser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...options.launchOptions });
  } catch (error) {
    return {
      available: false,
      reason:
        "Chromium could not be launched in this deployment — the 'playwright' package is present but its " +
        `browser binary may be missing or the host may not support the configured sandbox (run 'npx playwright install --with-deps chromium'). Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { available: true, browser };
}

/** Sandboxed public rendering: no unrouted network, including implicit loopback and WebRTC.
 * Port 9 (discard) on loopback: nothing listens, so an unrouted request fails instead of escaping.
 * Chromium implicitly bypasses proxies for loopback; `<-loopback>` removes that bypass. */
export const PUBLIC_RENDER_LAUNCH_OPTIONS = {
  headless: true, chromiumSandbox: true,
  args: ["--disable-dev-shm-usage", "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
};

