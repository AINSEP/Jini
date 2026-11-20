/**
 * Single entry point for the always-on observability observers (boot
 * timing, long tasks, resource-load errors, visibility/session length,
 * white-screen detection). `trackIframeLoad` (`iframe.ts`) is intentionally
 * NOT wired in here — it needs an iframe mount rather than a page-load install,
 * matching the origin module's own boundary.
 *
 * Call once, as early as possible (before the app tree mounts) so every
 * observer's early-buffering guarantees apply from the start. Each
 * observer is individually defensive (no-ops where its API is missing),
 * so this call is safe to make unconditionally.
 */
import { installLongTaskObserver, type LongTaskObserverOptions } from './long-task.js';
import { installResourceErrorObserver, type ResourceErrorObserverOptions } from './resource-error.js';
import { installBootTimingObserver, type BootTimingOptions } from './boot-timing.js';
import { installVisibilityObserver, type VisibilityObserverOptions } from './visibility.js';
import { installWhiteScreenDetector, type WhiteScreenDetectorOptions } from './white-screen.js';
import type { SafetyEventReporter } from './ports.js';

export interface WebObservabilityOptions {
  /** Applied to every observer below unless that observer's own nested
   *  options set a different one. */
  reporter?: SafetyEventReporter | undefined;
  longTask?: Omit<LongTaskObserverOptions, 'reporter'>;
  resourceError?: Omit<ResourceErrorObserverOptions, 'reporter'>;
  bootTiming?: Omit<BootTimingOptions, 'reporter'>;
  visibility?: Omit<VisibilityObserverOptions, 'reporter'>;
  whiteScreen?: Omit<WhiteScreenDetectorOptions, 'reporter'>;
}

let installed = false;

/**
 * Installs every always-on observer. Idempotent per page load; returns a
 * teardown that best-effort-tears down each observer (one observer's
 * teardown failure never blocks the others).
 *
 * @overallScore 100
 */
export function installWebObservability(options: WebObservabilityOptions = {}): () => void {
  if (installed) return () => undefined;
  if (typeof window === 'undefined') return () => undefined;
  installed = true;

  const { reporter } = options;
  const teardowns: Array<() => void> = [
    installLongTaskObserver({ ...options.longTask, reporter }),
    installResourceErrorObserver({ ...options.resourceError, reporter }),
    installBootTimingObserver({ ...options.bootTiming, reporter }),
    installVisibilityObserver({ ...options.visibility, reporter }),
    installWhiteScreenDetector({ ...options.whiteScreen, reporter }),
  ];

  return () => {
    for (const teardown of teardowns) {
      try {
        teardown();
      } catch {
        // best-effort — a teardown failure must never propagate.
      }
    }
    installed = false;
  };
}
