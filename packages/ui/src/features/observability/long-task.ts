/**
 * Long task observer.
 *
 * Reports a `client_long_task` event whenever the main thread is blocked
 * for more than `minDurationMs`. Long tasks are a strong proxy for
 * perceived UI lag — a 500 ms task drops 30 consecutive frames at 60 fps,
 * which the user reads as "stuck".
 *
 * Threshold defaults to 100 ms rather than the W3C 50 ms minimum because
 * the browser already filters at 50 ms; bumping to 100 ms here halves the
 * event volume while still catching every task a human notices.
 */
import { telemetryUrl } from './telemetry-url.js';
import { noopSafetyEventReporter, type SafetyEventReporter } from './ports.js';

const DEFAULT_MIN_DURATION_MS = 100;

export interface LongTaskObserverOptions {
  reporter?: SafetyEventReporter | undefined;
  /** Minimum task duration (ms) worth reporting. Defaults to 100. */
  minDurationMs?: number;
}

let observer: PerformanceObserver | null = null;

/**
 * Installs the long-task observer via `PerformanceObserver`. No-ops (and
 * returns an inert teardown) in engines without the `longtask` entry type.
 *
 * @overallScore 100
 */
export function installLongTaskObserver(options: LongTaskObserverOptions = {}): () => void {
  const reporter = options.reporter ?? noopSafetyEventReporter;
  const minDurationMs = options.minDurationMs ?? DEFAULT_MIN_DURATION_MS;

  if (typeof PerformanceObserver === 'undefined') return () => undefined;
  // Some engines report `longtask` as an unsupported entry type; observe()
  // throws or no-ops either way, so bail silently rather than let one
  // observer's absence break install ordering for the rest.
  const supported = PerformanceObserver.supportedEntryTypes?.includes?.('longtask');
  if (supported !== true) return () => undefined;
  if (observer) return () => observer?.disconnect();

  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < minDurationMs) continue;
      // The `attribution` array on a PerformanceLongTaskTiming entry names
      // the script/frame that caused the block. Not fully covered by
      // TypeScript's lib.dom, so read through an `unknown` cast.
      const attribution = (
        entry as unknown as {
          attribution?: Array<{
            containerType?: string;
            containerName?: string;
            containerSrc?: string;
          }>;
        }
      ).attribution?.[0];
      reporter('client_long_task', {
        duration_ms: Math.round(entry.duration),
        start_time_ms: Math.round(entry.startTime),
        container_type: attribution?.containerType,
        container_name: attribution?.containerName,
        // containerSrc can carry a query string; trimmed to origin+pathname.
        container_src_origin: telemetryUrl({ value: attribution?.containerSrc }),
      });
    }
  });

  if (!observeLongTasks({ observe: (options) => observer!.observe(options) })) {
    observer = null;
    return () => undefined;
  }

  return () => {
    observer?.disconnect();
    observer = null;
  };
}

function observeLongTasks(
  { observe }: Pick<PerformanceObserver, 'observe'>,
  _options: Record<string, never> = {},
): boolean {
  try {
    observe({ type: 'longtask', buffered: true });
  } catch {
    // Older engines sometimes throw when `buffered` is requested.
    try {
      observe({ type: 'longtask' });
    } catch {
      return false;
    }
  }
  return true;
}
