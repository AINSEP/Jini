/**
 * Post-build mount smoke check: actually EXECUTES a built, self-mounting browser bundle in a DOM
 * the host supplies and asserts it mounted, rather than only checking that the build succeeded.
 *
 * Why an execution smoke test, not a text/grep check: builds have shipped that compiled cleanly,
 * passed typecheck and were served fine, yet threw immediately on load in a real browser
 * (`process is not defined`, then a null-dispatcher crash from two different React instances
 * getting bundled together). Neither would be caught by "does the build succeed" or a narrow
 * string grep — the second has no fixed string signature to search for, since it is about which
 * MODULE INSTANCE resolved, not what text survived. Running the artifact and checking it actually
 * mounted is the one check general enough to catch "the bundle throws on load" as a category.
 *
 * Not a substitute for driving a real browser: the host's DOM (e.g. jsdom) never opens the widget
 * or exercises its network transport. It exists to fail builds loudly and immediately for the
 * cheapest, most common failure mode — the bundle cannot even execute.
 *
 * Vendor neutrality: the DOM implementation is injected as `createDom`, the settle wait as `wait`,
 * and the CLI's file read, stderr and exit as ports, so this module imports no DOM library and
 * never touches the process itself.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A failed check. Thrown rather than exiting, so every check is callable from a test;
 *  {@link runBundleCheckCli} is the one place that turns it into a message and exit status. */
export class BundleCheckError extends Error {}

/** Abort the check with `message`. @throws {BundleCheckError} always. */
export function fail({ message }: { message: string }, _optional: Record<string, never> = {}): never {
  throw new BundleCheckError(message);
}

/** The error/rejection event fields the harness reads. */
export interface BundleSmokeErrorEvent { error?: unknown; message?: unknown; reason?: unknown }
/** The mount element fields the harness reads. */
export interface BundleSmokeElement { readonly children: { readonly length: number } }
/** The `matchMedia` result shape the stub returns. */
export interface BundleSmokeMediaQueryList {
  matches: boolean; media: string; addEventListener(type: string, listener: unknown): void; removeEventListener(type: string, listener: unknown): void;
}

/** The window surface the harness uses; a jsdom `DOMWindow` satisfies it structurally. */
export interface BundleSmokeWindow {
  eval(source: string): unknown;
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: BundleSmokeErrorEvent) => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  readonly document: { getElementById(id: string): BundleSmokeElement | null };
  readonly sessionStorage: unknown;
  readonly Element: { prototype: object };
  requestAnimationFrame?: (callback: (time: number) => void) => unknown;
  matchMedia?: (query: string) => BundleSmokeMediaQueryList;
}

/** One fresh DOM from the host. `onConsoleError` receives the DOM library's own error reports
 *  (jsdom: the virtual console's `jsdomError`); `dispose` releases it (jsdom: `window.close()`). */
export interface BundleSmokeDom<W extends BundleSmokeWindow = BundleSmokeWindow> {
  readonly window: W;
  onConsoleError(listener: (error: unknown) => void): void;
  dispose(): void;
}

/** Host-supplied DOM factory; it must return a NEW DOM on every call. */
export type CreateBundleDom<W extends BundleSmokeWindow = BundleSmokeWindow> = (required: { html: string; url: string }) => BundleSmokeDom<W>;

/** A host scenario: seed state before the bundle runs, then verify the mounted page. */
export interface BundleScenario<W extends BundleSmokeWindow = BundleSmokeWindow> {
  readonly name: string;
  seed?(required: { storage: W['sessionStorage'] }): void;
  verify?(required: { storage: W['sessionStorage']; document: W['document']; navigationAttempts: readonly string[] }): void;
}

/** The host page every scenario runs in. */
export interface BundleSmokePage<W extends BundleSmokeWindow = BundleSmokeWindow> {
  createDom: CreateBundleDom<W>;
  /** The id of the element the bundle mounts into; it is present in the page ahead of the script. */
  mountId: string;
  /** Extra page content placed after the mount element. */
  pageHtml: string;
  url: string;
}

export interface BundleScenarioOptions {
  /** Post-eval settle wait in ms (see the comment at that wait). */
  settleMs?: number;
  /** Receives the one OK line per passing scenario. */
  log?: (line: string) => void;
  /** Settle-wait port; defaults to a real timer. */
  wait?: (required: { ms: number }) => Promise<void>;
  /** Prefix for the OK line. */
  label?: string;
}

/** Whether a DOM console error is the "Not implemented: navigation" report. */
export function isNavigationError({ error }: { error: unknown }, _optional: Record<string, never> = {}): boolean {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.includes('navigation');
}

function failOnErrors({ caughtErrors, heading }: { caughtErrors: unknown[]; heading: string }): void {
  if (caughtErrors.length === 0) return;
  fail({ message: `${heading}\n` + caughtErrors.map((error) => `  - ${(error as { stack?: unknown } | null | undefined)?.stack ?? error}`).join('\n') });
}

/** Install the three page APIs a DOM-only library like jsdom lacks and every real browser has.
 *  `requestAnimationFrame` is absent on a fresh jsdom window, yet every real browser has had it for
 *  over a decade, so its absence is a harness gap, not a bug: a bundle whose queued page action
 *  runs through it would throw `ReferenceError` here only. `scrollIntoView`/`matchMedia` need the
 *  same treatment because the DOM does no layout at all. The scroll stub records its calls on the
 *  element (`__jiniScrollIntoView*`) so a scenario can assert whether anything scrolled. */
function stubBrowserGaps({ window }: { window: BundleSmokeWindow }): void {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0);
  (window.Element.prototype as Record<string, unknown>).scrollIntoView = function scrollIntoViewStub(this: Record<string, unknown>, options: unknown) {
    this.__jiniScrollIntoViewCalls = ((this.__jiniScrollIntoViewCalls as number | undefined) ?? 0) + 1;
    this.__jiniLastScrollIntoViewOptions = options;
  };
  window.matchMedia = (query) => ({
    matches: false, // a smoke check exercises no prefers-reduced-motion branch; unit tests cover those directly.
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Wire one fresh DOM: navigation capture, browser-gap stubs, seeded storage and error capture. */
function prepareDom<W extends BundleSmokeWindow>({ dom, scenario }: { dom: BundleSmokeDom<W>; scenario: BundleScenario<W> }) {
  // A DOM library without real navigation (jsdom) reports `location.assign`/`.href =` as a console
  // error ("Not implemented: navigation...") instead of reloading. That is exactly the observable
  // signal a "must not navigate on mount" scenario needs: one evaluation of the bundle is exactly
  // one mount, so counting these asks "did THIS mount attempt to navigate", independent of whether
  // the DOM could have carried the navigation out.
  const navigationAttempts: string[] = [];
  dom.onConsoleError((error) => {
    if (isNavigationError({ error })) navigationAttempts.push(String((error as { message: string }).message));
  });
  stubBrowserGaps({ window: dom.window });
  scenario.seed?.({ storage: dom.window.sessionStorage });
  const caughtErrors: unknown[] = [];
  dom.window.addEventListener('error', (event) => { caughtErrors.push(event.error ?? event.message); });
  dom.window.addEventListener('unhandledrejection', (event) => { caughtErrors.push(event.reason); });
  return { navigationAttempts, caughtErrors };
}

function evaluateBundle({ window, bundleSource, caughtErrors }: { window: BundleSmokeWindow; bundleSource: string; caughtErrors: unknown[] }): void {
  try {
    window.eval(bundleSource);
  } catch (error) {
    // A synchronous throw during evaluation (e.g. `ReferenceError: process is not defined` at the top
    // of the IIFE) never reaches the `error` event listener — the DOM's `eval` re-throws it directly.
    // Caught here so one failure message covers both this and the async path.
    caughtErrors.push(error);
  }
}

function assertMounted({ window, mountId, name }: { window: BundleSmokeWindow; mountId: string; name: string }): BundleSmokeElement {
  const mountElement = window.document.getElementById(mountId);
  if (!mountElement) fail({ message: `[${name}] #${mountId} is missing from the DOM after evaluating the bundle` });
  if (mountElement.children.length === 0) {
    fail({ message: `[${name}] #${mountId} has no children after evaluating the bundle — nothing mounted into it` });
  }
  return mountElement;
}

const realWait = ({ ms }: { ms: number }) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Runs the built bundle once, in a fresh DOM, after `scenario.seed`. A fresh DOM per scenario is
 * required, not incidental: the bundle self-mounts via an IIFE the moment it is evaluated, so
 * replaying it against an already-mounted window would either double-mount or hit the "someone else
 * already owns this DOM" branch instead of the seeded mount path the scenario wants to test. The DOM
 * is disposed on every exit, pass or fail, so no scenario leaks timers into the next.
 *
 * @complexity O(1) DOM/eval work per call; the caller decides how many scenarios to run.
 */
export async function runBundleScenario<W extends BundleSmokeWindow>(
  { scenario, bundleSource, createDom, mountId, pageHtml, url }: BundleSmokePage<W> & { scenario: BundleScenario<W>; bundleSource: string },
  { settleMs = 150, log = () => {}, wait = realWait, label = 'bundle-mount-smoke' }: BundleScenarioOptions = {},
): Promise<void> {
  // The mount element is present ahead of the script, as on a real page, so the bundle takes the
  // same "find my mount point" path a real page does, not its defensive create-one fallback.
  const dom = createDom({ html: `<!doctype html><html><body><div id="${escapeAttribute(mountId)}"></div>${pageHtml}</body></html>`, url });
  try {
    const { navigationAttempts, caughtErrors } = prepareDom({ dom, scenario });
    evaluateBundle({ window: dom.window, bundleSource, caughtErrors });
    failOnErrors({ caughtErrors, heading: `[${scenario.name}] the bundle threw during execution — it would have crashed on load in a real browser:` });
    // React 19's `createRoot(...).render(...)` schedules the initial commit through its own scheduler
    // (message-channel/timeout-based), not synchronously within the `eval` above — measured: without
    // this wait the mount element reads as childless even on a bundle that mounts correctly a moment
    // later. A real macrotask tick, not a microtask, is what the scheduler waits on. 150ms (not 100ms):
    // the `requestAnimationFrame` stub adds one more macrotask hop after the mount commit, for
    // scenarios that queue a real page action.
    await wait({ ms: settleMs });
    failOnErrors({ caughtErrors, heading: `[${scenario.name}] the bundle threw after mounting (a post-mount effect or async error):` });
    const mountElement = assertMounted({ window: dom.window, mountId, name: scenario.name });
    scenario.verify?.({ storage: dom.window.sessionStorage, document: dom.window.document, navigationAttempts });
    log(`[${label}] OK [${scenario.name}] — bundle executed cleanly and mounted ${mountElement.children.length} child element(s) into #${mountId}.`);
  } finally {
    dom.dispose();
  }
}

/** Run every scenario against one bundle, in order; the first failure throws. */
export async function checkBundleMounts<W extends BundleSmokeWindow>(
  { scenarios, ...page }: BundleSmokePage<W> & { scenarios: readonly BundleScenario<W>[]; bundleSource: string },
  options: BundleScenarioOptions = {},
): Promise<void> {
  for (const scenario of scenarios) {
    await runBundleScenario({ ...page, scenario }, options);
  }
}

/** The built bundle's text; an unreadable file is a check failure naming the likely cause. */
function readBundle({ bundlePath, readText }: { bundlePath: string; readText: (file: string) => string }): string {
  try {
    return readText(bundlePath);
  } catch (cause) {
    return fail({ message: `could not read ${bundlePath} — did the build run first? (${(cause as Error).message})` });
  }
}

/** CLI ports and the check the host binds (its page, scenarios and DOM factory). */
export interface BundleCheckCliPorts {
  bundlePath: string;
  readText: (file: string) => string;
  check: (required: { bundleSource: string }) => Promise<void>;
  error: (line: string) => void;
  exit: (code: number) => void;
}

/**
 * The CLI body: read the built bundle and run the host's check, reporting a check failure on
 * `error` with exit status 1. Anything that is not a {@link BundleCheckError} is a bug and rethrows.
 * @returns the exit status it reported (0 when every scenario passed).
 */
export async function runBundleCheckCli(
  { bundlePath, readText, check, error, exit }: BundleCheckCliPorts,
  { label = 'bundle-mount-smoke' }: { label?: string } = {},
): Promise<number> {
  try {
    await check({ bundleSource: readBundle({ bundlePath, readText }) });
    return 0;
  } catch (cause) {
    if (!(cause instanceof BundleCheckError)) throw cause;
    error(`[${label}] FAIL: ${cause.message}`);
    exit(1);
    return 1;
  }
}

/** Whether `moduleUrl` is the script node was started with (`argv1`, i.e. `process.argv[1]`). */
export function isEntryPoint({ moduleUrl, argv1 }: { moduleUrl: string; argv1: string | undefined }, _optional: Record<string, never> = {}): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(path.resolve(argv1)).href;
}
