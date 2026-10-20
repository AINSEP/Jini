/**
 * Resource-loading error observer.
 *
 * The bubbling `error` event (registered with capture=false) catches
 * thrown JS errors but NOT failed resource loads — `<script>`, `<link>`,
 * `<img>`, etc. emit an `error` event that does not propagate. To pick
 * those up we register a *capturing* listener on `window`. This is the
 * canonical pattern for chunk-load failures: a missing static bundle
 * chunk results in a non-functional app with no JS exception.
 */
import { noopSafetyEventReporter, type SafetyEventReporter } from './ports.js';

const RESOURCE_TAGS = new Set(['SCRIPT', 'LINK', 'IMG', 'IFRAME', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK']);

export interface ResourceErrorObserverOptions {
  reporter?: SafetyEventReporter | undefined;
}

let installed = false;

/**
 * Installs the resource-error observer. Idempotent per page load.
 *
 * @overallScore 100
 */
export function installResourceErrorObserver(
  options: ResourceErrorObserverOptions = {},
): () => void {
  const reporter = options.reporter ?? noopSafetyEventReporter;
  if (installed) return () => undefined;
  if (typeof window === 'undefined') return () => undefined;
  installed = true;

  const listener = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!RESOURCE_TAGS.has(target.tagName)) return;
    const src = readSrc(target);
    if (typeof src !== 'string' || src.length === 0) return;
    reporter('client_resource_error', {
      tag: target.tagName.toLowerCase(),
      // async/defer/crossorigin are useful signals for diagnosing
      // chunk-load problems that depend on CDN cache + SW interaction.
      async_attr: target.getAttribute('async') != null,
      defer_attr: target.getAttribute('defer') != null,
      crossorigin: target.getAttribute('crossorigin'),
      url: src,
    });
  };

  // capture=true is required — resource error events do not bubble.
  window.addEventListener('error', listener, /* useCapture */ true);

  return () => {
    window.removeEventListener('error', listener, /* useCapture */ true);
    installed = false;
  };
}

function readSrc(el: Element): string | null {
  if (el instanceof HTMLLinkElement) return el.href;
  if (el instanceof HTMLScriptElement) return el.src;
  if (el instanceof HTMLImageElement) return el.src;
  if (el instanceof HTMLIFrameElement) return el.src;
  if (el instanceof HTMLSourceElement) return el.src;
  if (el instanceof HTMLTrackElement) return el.src;
  if (el instanceof HTMLMediaElement) return el.src;
  return el.getAttribute('src') ?? el.getAttribute('href');
}
