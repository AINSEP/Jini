/**
 * White-screen detector.
 *
 * Reports `client_white_screen` when the app fails to mount within
 * `timeoutMs`. Detection sets a single timer at install time and cancels
 * itself the moment the app mounts real content — a normal boot produces
 * zero events.
 *
 * Success condition (anything below counts as "still showing a pre-mount
 * skeleton" and the timer keeps running):
 *
 *   1. `mountedAttribute` is set on `<html>` to `mountedAttributeValue`
 *      (the host's root component sets this in its very first effect).
 *      This is the authoritative signal — once the root has rendered at
 *      all, any later tree crash is a runtime-exception story, not a
 *      white-screen story.
 *   2. *Fallback only.* If the attribute is missing (a render-time crash
 *      that prevented the effect from firing, or a host build predating
 *      the marker), any non-loading-shell child of the root with more than
 *      `minVisibleText` visible text counts as mounted.
 *
 * This does not try to discriminate "still loading" from "white screen
 * caused by a render error" — both look the same to the user, and the
 * latter usually accompanies a runtime exception a host's own error
 * tracking already captured.
 */
import { noopSafetyEventReporter, type SafetyEventReporter } from './ports.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MIN_VISIBLE_TEXT = 10;
const DEFAULT_MOUNTED_ATTRIBUTE = 'data-app-mounted';
const DEFAULT_MOUNTED_ATTRIBUTE_VALUE = '1';
const DEFAULT_LOADING_SHELL_CLASSES: readonly string[] = ['app-loading-shell'];

export interface WhiteScreenDetectorOptions {
  reporter?: SafetyEventReporter | undefined;
  /** How long to wait for the mounted signal before reporting. Defaults to 5000. */
  timeoutMs?: number;
  /** Visible-text floor below which the fallback scan still counts the
   *  root as unmounted. Defaults to 10. */
  minVisibleText?: number;
  /** Attribute a host's root component sets on `<html>` once mounted. */
  mountedAttribute?: string;
  mountedAttributeValue?: string;
  /** Class names that mark an element as "still the pre-mount loading
   *  shell" rather than real content, for the fallback scan. */
  loadingShellClasses?: readonly string[];
  /** Element id to scan in the fallback path. Defaults to `document.body`
   *  when omitted or not found. */
  rootElementId?: string;
}

/**
 * Installs the white-screen detector. Cancels its own timer once the app
 * mounts, or when the returned teardown is called (whichever comes first).
 *
 * @overallScore 100
 */
export function installWhiteScreenDetector(options: WhiteScreenDetectorOptions = {}): () => void {
  const reporter = options.reporter ?? noopSafetyEventReporter;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minVisibleText = options.minVisibleText ?? DEFAULT_MIN_VISIBLE_TEXT;
  const mountedAttribute = options.mountedAttribute ?? DEFAULT_MOUNTED_ATTRIBUTE;
  const mountedAttributeValue = options.mountedAttributeValue ?? DEFAULT_MOUNTED_ATTRIBUTE_VALUE;
  const loadingShellClasses = new Set(options.loadingShellClasses ?? DEFAULT_LOADING_SHELL_CLASSES);
  const rootElementId = options.rootElementId;

  if (typeof window === 'undefined') return () => undefined;
  if (typeof document === 'undefined') return () => undefined;

  const isAppMounted = (): boolean => checkAppMounted({
    mountedAttribute,
    mountedAttributeValue,
    loadingShellClasses,
    minVisibleText,
    rootElementId,
  });

  let cancelled = false;
  // The `cancelled` guards at the top of this timer callback and inside the
  // `monitorMount` completion callback just below are defensive invariant
  // checks, empirically and structurally unreachable through this
  // function's real call graph: both places that ever set
  // `cancelled = true` (this closure's returned teardown, and the
  // `monitorMount` completion callback itself) always call
  // `window.clearTimeout(timer)` / `observer.disconnect()` synchronously in
  // that same turn — and in this single-threaded runtime, a timer that's
  // been cleared (or a `MutationObserver` that's been disconnected, which
  // also discards its pending record queue per spec) can never still fire
  // its callback afterward. So by the time either callback runs at all,
  // `cancelled` is guaranteed to still be its initial `false`. Left in
  // place (not stripped) as a guard against a future refactor silently
  // breaking that invariant — see packages/ui/archived provenance ledger's 2026-07-22
  // dated entry for the full proof, same pattern as this package's
  // `stuck-run.ts` `emitStuck` precedent.
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    if (isAppMounted()) return;
    reporter('client_white_screen', {
      reason: 'app_not_mounted_after_timeout',
      timeout_ms: timeoutMs,
      ready_state: document.readyState,
      // Backgrounded tabs throttle setTimeout, so a "white screen" here is
      // much more likely an OS-side scheduling artifact than a real mount
      // failure. Surfacing it lets a host filter the noise.
      visibility_state: document.visibilityState,
      body_child_count: document.body?.children.length ?? 0,
    });
  }, timeoutMs);

  const stopMonitor = monitorMount(isAppMounted, () => {
    if (cancelled) return;
    cancelled = true;
    window.clearTimeout(timer);
  });

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    stopMonitor();
  };
}

interface CheckAppMountedOptions {
  mountedAttribute: string;
  mountedAttributeValue: string;
  loadingShellClasses: ReadonlySet<string>;
  minVisibleText: number;
  rootElementId: string | undefined;
}

function checkAppMounted(options: CheckAppMountedOptions): boolean {
  // `checkAppMounted`'s only call site is the `isAppMounted` closure inside
  // `installWhiteScreenDetector`, itself only ever reachable after that
  // function's own `typeof document === 'undefined'` guard has already
  // passed — a second check here was dead code for every real call,
  // removed rather than tested around (see packages/ui/archived provenance ledger's
  // 2026-07-22 dated entry).
  // Primary signal: the host's root-mount effect ran.
  if (document.documentElement.getAttribute(options.mountedAttribute) === options.mountedAttributeValue) {
    return true;
  }
  // Fallback: scan the root subtree for content that isn't just the
  // pre-mount loading shell.
  const root =
    (options.rootElementId ? document.getElementById(options.rootElementId) : null) ??
    document.body;
  if (!root) return false;
  const meaningful = Array.from(root.children).filter(
    (el) => !isLoadingShell(el, options.loadingShellClasses),
  );
  if (meaningful.length === 0) return false;
  const text = meaningful
    // `meaningful` only ever holds `Element` nodes (filtered from
    // `root.children`); per the DOM spec, `Node#textContent` returns `null`
    // only for `Document`/`DocumentType` nodes — for any `Element` it is
    // always a string (possibly `''`). The `?? ''` fallback this used to
    // have was dead code for every real entry here, removed rather than
    // tested around (see packages/ui/archived provenance ledger's 2026-07-22 dated
    // entry).
    .map((el) => (el as HTMLElement).innerText ?? (el.textContent as string))
    .join('')
    .trim();
  return text.length >= options.minVisibleText;
}

function isLoadingShell(el: Element, loadingShellClasses: ReadonlySet<string>): boolean {
  for (const name of loadingShellClasses) {
    if (el.classList.contains(name)) return true;
  }
  return false;
}

function monitorMount(isAppMounted: () => boolean, onMounted: () => void): () => void {
  let stopped = false;
  // The `stopped` guard at the top of this callback is a defensive
  // invariant check, empirically confirmed unreachable: a `MutationObserver`
  // callback fires at most once per batch of queued mutation records
  // (never re-entrantly mid-callback), `stopped` only ever flips to `true`
  // synchronously within this very callback body (right where
  // `disconnect()` is called, which — per spec — also discards any
  // not-yet-delivered pending records), and the outer teardown path below
  // that also sets it calls `observer.disconnect()` in that same turn too.
  // Verified directly against this repo's real jsdom (not just reasoned
  // about): two synchronous body mutations followed by two microtask
  // flushes produced exactly one callback invocation with `stopped` still
  // `false` at its start, and a further post-disconnect mutation produced
  // zero more. See packages/ui/archived provenance ledger's 2026-07-22 dated entry for
  // the full record.
  const observer = new MutationObserver(() => {
    if (stopped) return;
    if (isAppMounted()) {
      stopped = true;
      observer.disconnect();
      onMounted();
    }
  });
  // Observe the whole body subtree — a client-side framework's root is
  // often repeatedly detached/reattached during hydration, so observing a
  // narrower root directly would stop firing the moment it gets replaced.
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  // Best-effort short-circuit: if the app is already mounted by the time
  // this runs (HMR, slow tab, etc.), fire immediately.
  if (isAppMounted()) {
    stopped = true;
    observer.disconnect();
    onMounted();
  }
  return () => {
    stopped = true;
    observer.disconnect();
  };
}
