import { escapeHtmlAttribute } from './html-utils.js';
import { buildSandboxedDocument } from './sandboxed-document.js';
import type { SandboxedDocumentOptions } from './types.js';

export interface NewTabPreviewOptions extends SandboxedDocumentOptions {
  /** Allow `window.showModalDialog`-style native modals (`alert`/`confirm`/`prompt`) inside the sandboxed frame. Defaults to `false`. */
  allowModals?: boolean;
}

/**
 * Build the standalone page opened in a new tab: a tiny host document whose
 * body is entirely filled by a second, inner sandboxed iframe carrying the
 * real artifact HTML as its `srcdoc` attribute. Going through a nested
 * `srcdoc` iframe (rather than writing the artifact directly into the new
 * tab's own document) keeps the artifact's script execution sandboxed even
 * once it's opened outside the host app's own preview chrome.
 */
export function buildSandboxedPreviewPage(
  html: string,
  title: string,
  options: NewTabPreviewOptions = {},
): string {
  const { html: innerDoc } = buildSandboxedDocument(html, options);
  const safeTitle = escapeHtmlAttribute(title || 'Preview');
  const sandbox = options.allowModals ? 'allow-scripts allow-modals' : 'allow-scripts';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden;background:#fff}</style>
</head>
<body>
  <iframe title="${safeTitle}" sandbox="${sandbox}" srcdoc="${escapeHtmlAttribute(innerDoc)}"></iframe>
</body>
</html>`;
}

/** How long to keep the Blob URL alive before revoking it, in milliseconds. Generous enough for a slow browser to have started navigating before the object is freed. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Open sandboxed `html` in a new browser tab via a Blob URL. Returns
 * `false` (a no-op) when there's no browser environment to open a tab in,
 * or when the popup was blocked; `true` once `window.open` has returned a
 * window reference.
 */
export function openSandboxedPreviewInNewTab(
  html: string,
  title: string,
  options: NewTabPreviewOptions = {},
): boolean {
  if (
    typeof window === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Blob === 'undefined'
  ) {
    return false;
  }
  const page = buildSandboxedPreviewPage(html, title, options);
  const blob = new Blob([page], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return opened != null;
}
