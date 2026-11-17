/**
 * @file The OAuth popup landing page a redirect URI serves, shared by every flow that opens a popup.
 *
 * ## Why this page is safe, restated because it is the reason it can be shared
 *
 * NOTHING from the request is interpolated. Not a connector id, not a server id, not an error, not
 * any query parameter. The two variants are fixed copy chosen by a boolean, and the ONE parameterized
 * value ({@link OAuthCallbackPageInput.messageType}) is a compile-time constant chosen by the calling
 * route and passed through `JSON.stringify` (with `<`, U+2028 and U+2029 escaped) into a script
 * literal. No code path here concatenates request data into markup, so an attacker-controlled
 * `state` or `status` cannot reach the document. The host-authored copy is HTML-escaped as well.
 *
 * `postMessage` targets `window.location.origin` rather than `"*"`, so the message cannot be read by
 * a cross-origin opener, and the receiving bridge independently checks `event.origin`.
 *
 * ## The failure reason is a second parameter, and it is closed for the same reason `messageType` is
 *
 * {@link OAuthCallbackPageInput.reason} chooses which of the host's fixed copy blocks renders, and is
 * included in the `postMessage` payload so the opener tab can react to it. It is never a raw error,
 * never a provider's `error`/`error_description`, never anything read off the request: the caller
 * classifies its caught failure into the host's closed vocabulary FIRST. A reason outside that
 * vocabulary renders the default reason's copy, so the page fails closed.
 *
 * ## Why the message type is a parameter
 *
 * Each flow gets its own type string so one flow's completion cannot make another flow's bridge
 * think it finished.
 *
 * ## The focus fallback is not optional
 *
 * `window.opener` is absent in a system browser opened without an opener relationship, and the
 * `try/catch` around `postMessage` swallows the cross-origin case. Both leave the message
 * undelivered, which is why every bridge that consumes this page ALSO re-checks connection status
 * when the opener tab regains focus. An operator who abandons the popup must resolve as "still not
 * connected", not as an error.
 */
import { escapeHtml } from '@jini-ai/core/text';

/** Host-authored copy: one fixed heading/body pair per variant. Never request-derived. */
export interface OAuthCallbackPageCopy<Reason extends string> {
  readonly successHeading: string;
  readonly successBody: string;
  /** Every failure reason shares one heading; the body carries the specific explanation. */
  readonly failureHeading: string;
  readonly failureBodies: Readonly<Record<Reason, string>>;
  /** Rendered, and announced to the opener, when a failure carries no (or an unknown) reason. */
  readonly defaultReason: Reason;
}

export interface OAuthCallbackPageInput<Reason extends string> {
  /** Chooses which of the two FIXED copy variants is rendered. Never derived from request data. */
  readonly ok: boolean;
  /** The `postMessage` type this page announces. A compile-time constant, never a request value. */
  readonly messageType: string;
  /** Which closed-vocabulary reason to render when `ok` is `false`; ignored when `ok` is `true`. */
  readonly reason?: Reason | undefined;
  readonly copy: OAuthCallbackPageCopy<Reason>;
}

export interface OAuthCallbackPageOptions {
  /** The document language. Defaults to `en`. */
  readonly lang?: string | undefined;
  /** Delay before the success popup closes itself. Defaults to 400 ms. */
  readonly successCloseMs?: number | undefined;
  /** Delay before the failure popup closes itself, long enough to read the copy. Defaults to 2500 ms. */
  readonly failureCloseMs?: number | undefined;
}

/** JSON that is safe inside an inline `<script>`: no `</script>`, `<!--` or line-terminator escapes. */
function scriptSafeJson({ value }: { value: unknown }): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The closed-vocabulary reason to show: the caller's when it is a member, else the default. */
function resolveReason<Reason extends string>({ reason, copy }: { reason: Reason | undefined; copy: OAuthCallbackPageCopy<Reason> }): Reason {
  return reason !== undefined && Object.hasOwn(copy.failureBodies, reason) ? reason : copy.defaultReason;
}

/**
 * Renders the popup's landing page.
 *
 * @returns A complete HTML document. Safe to serve to anyone who can guess the URL, because it
 * contains no request-derived content and no provider error text.
 * @complexity O(copy length).
 */
export function renderOAuthCallbackPage<Reason extends string>(
  { ok, messageType, reason, copy }: OAuthCallbackPageInput<Reason>,
  { lang = 'en', successCloseMs = 400, failureCloseMs = 2500 }: OAuthCallbackPageOptions = {},
): string {
  const shown = resolveReason({ reason, copy });
  const heading = escapeHtml({ text: ok ? copy.successHeading : copy.failureHeading });
  const body = escapeHtml({ text: ok ? copy.successBody : copy.failureBodies[shown] });
  // Built as one object and serialized once, rather than hand-assembling a JS object literal, so
  // `reason` gets the same JSON-encoding safety `messageType` has. `reason` is omitted on success.
  const payload = ok ? { type: messageType } : { type: messageType, reason: shown };
  return `<!doctype html>
<html lang="${escapeHtml({ text: lang })}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    text-align: center; padding: 24px;
  }
  h1 { font-size: 17px; margin: 0 0 6px; }
  p { margin: 0; opacity: 0.7; font-size: 13px; }
</style>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <p>${body}</p>
  </main>
  <script>
    (function () {
      try {
        if (window.opener) {
          window.opener.postMessage(${scriptSafeJson({ value: payload })}, window.location.origin);
        }
      } catch (e) { /* opener gone or cross-origin — the bridge's refocus listener covers it */ }
      setTimeout(function () { try { window.close(); } catch (e) {} }, ${ok ? successCloseMs : failureCloseMs});
    })();
  </script>
</body>
</html>`;
}
