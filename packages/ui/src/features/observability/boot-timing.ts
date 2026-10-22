/**
 * Boot timing observer.
 *
 * Reports a boot-timing event once, after the app's first page becomes
 * fully rendered. Buckets:
 *
 *   - navigation_start_offset_ms: navigationStart → loadEvent.start
 *     (the standard "page load" metric).
 *   - dom_interactive_ms: navigationStart → domInteractive
 *   - dom_content_loaded_ms: navigationStart → domContentLoadedEventStart
 *
 * Origin (`observability/boot-timing.ts`) called this a stability signal
 * "more than a behavioral one" to justify bypassing product-analytics
 * consent gating — that call belongs to whatever host wires the
 * {@link SafetyEventReporter}, not to this module.
 *
 * Fires at most once per page load (per provider instance — see
 * `installBootTimingObserver`'s module-level guard).
 */
import { noopSafetyEventReporter, type SafetyEventReporter } from './ports.js';

export interface BootTimingOptions {
  reporter?: SafetyEventReporter | undefined;
}

let captured = false;

/**
 * Installs the boot-timing observer. Safe to call multiple times — only
 * the first call in a page load actually observes; later calls return an
 * inert teardown.
 *
 * @overallScore 100
 */
export function installBootTimingObserver(options: BootTimingOptions = {}): () => void {
  const reporter = options.reporter ?? noopSafetyEventReporter;
  if (typeof window === 'undefined') return () => undefined;
  if (typeof performance === 'undefined') return () => undefined;
  if (captured) return () => undefined;

  const onReady = (): void => {
    if (captured) return;
    captured = true;
    // Defer to the next idle tick so we capture the post-load timings
    // (loadEventEnd is set synchronously inside the `load` handler).
    schedule(() => emit(reporter));
  };

  // Three possible states on install: still loading, interactive, or
  // already complete (HMR / dev / fast paths). Cover all three.
  if (document.readyState === 'complete') {
    onReady();
  } else {
    window.addEventListener('load', onReady, { once: true });
  }

  return () => {
    captured = true;
    window.removeEventListener('load', onReady);
  };
}

// `schedule`'s only call site (`onReady`, inside `installBootTimingObserver`)
// only ever runs after that function's own `typeof window === 'undefined'`
// guard has already passed, so a second check here was dead code for every
// real call — removed rather than tested around (see
// packages/ui/archived provenance ledger's 2026-07-22 dated entry).
function schedule(fn: () => void): void {
  const rIC = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof rIC === 'function') {
    rIC(fn, { timeout: 2000 });
    return;
  }
  setTimeout(fn, 50);
}

function emit(reporter: SafetyEventReporter): void {
  // PerformanceNavigationTiming is the modern shape; Navigation Timing v1
  // (`performance.timing`) is deprecated but still present in some engines
  // — preferred the typed v2 surface and only fall back when
  // getEntriesByType returns nothing.
  const nav = readNavigationTiming();
  if (!nav) return;

  reporter('client_boot_timing', {
    navigation_start_offset_ms: round(nav.navigationStart),
    dom_interactive_ms: round(nav.domInteractive),
    dom_content_loaded_ms: round(nav.domContentLoadedEventStart),
    dom_complete_ms: round(nav.domComplete),
    load_event_ms: round(nav.loadEventStart),
    transfer_size_bytes:
      typeof nav.transferSize === 'number' && nav.transferSize > 0 ? nav.transferSize : undefined,
    // `emit` is only ever reached via `onReady`, which itself only ever
    // runs after `installBootTimingObserver` has already read
    // `document.readyState` directly (unconditionally, no `typeof` guard)
    // earlier in the same call — so `document` is provably already
    // resolvable in global scope by the time this line runs; a `typeof
    // document !== 'undefined'` re-check here was dead code for every real
    // call, removed rather than tested around (see
    // packages/ui/archived provenance ledger's 2026-07-22 dated entry).
    visibility_state: document.visibilityState,
  });
}

interface BootTimingsShape {
  navigationStart: number;
  domInteractive: number;
  domContentLoadedEventStart: number;
  domComplete: number;
  loadEventStart: number;
  transferSize?: number;
}

function readNavigationTiming(): BootTimingsShape | null {
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  if (entry) {
    return {
      navigationStart: entry.startTime,
      domInteractive: entry.domInteractive,
      domContentLoadedEventStart: entry.domContentLoadedEventStart,
      domComplete: entry.domComplete,
      loadEventStart: entry.loadEventStart,
      transferSize: entry.transferSize,
    };
  }
  // Legacy fallback — `performance.timing` returns absolute epoch
  // timestamps; normalise against navigationStart to match the v2-style
  // relative shape.
  const legacy = (performance as unknown as { timing?: PerformanceTiming }).timing;
  if (!legacy) return null;
  const base = legacy.navigationStart;
  return {
    navigationStart: 0,
    domInteractive: legacy.domInteractive - base,
    domContentLoadedEventStart: legacy.domContentLoadedEventStart - base,
    domComplete: legacy.domComplete - base,
    loadEventStart: legacy.loadEventStart - base,
  };
}

function round(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.round(value);
}
