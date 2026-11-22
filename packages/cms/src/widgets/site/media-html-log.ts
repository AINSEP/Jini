/** Host binding for the Raw HTML pipeline's diagnostics: the pipeline reports `{ code, detail }`
 * events and never logs; the host keeps today's console lines (text and arguments) so the server log
 * still shows a dropped tag, an unknown slug or a media-kind mismatch the moment a page renders. */
import type { MediaHtmlEvent } from '../html/index.js';

const MESSAGES: Readonly<Record<string, string>> = {
  'raw-html-dropped': '[media] Raw HTML sanitizer dropped markup',
  'media-kind-mismatch': '[media] media kind does not match Raw HTML element',
  'unknown-media-slug': '[media] unknown slug in raw HTML',
};

export function logMediaHtmlEvent({ code, detail }: MediaHtmlEvent, _optional: Record<string, never> = {}): void {
  console.warn(MESSAGES[code] ?? `[media] ${code}`, JSON.parse(detail));
}
