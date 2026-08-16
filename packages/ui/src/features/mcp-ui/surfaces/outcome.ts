/**
 * @module features/mcp-ui/surfaces/outcome
 *
 * A read-only RESULT surface: the human already answered a confirmation (or submitted a form, or a
 * background action finished) and this is what actually happened, not what was proposed.
 *
 * ## Why this exists
 *
 * `document.ts`'s `DEFAULT_SURFACE_STATUS_TEXT.done` ("Done.") fires the instant a surface's
 * `tools/call` RESOLVES — that proves the call reached the Host and came back, never that the
 * underlying operation actually succeeded. A publish that 404s, a rejected credential, and a
 * partial upload all resolve the SAME call and render the SAME "Done.". Worse, for a HELD-OPEN
 * confirmation answered through `mcp-ui-tool-calls-route.ts`'s Shape 1 (an exchange delivery), the
 * click's own `tools/call` round trip resolves the instant the answer is DELIVERED to the parked
 * agent call (`{delivered: true}`, HTTP 202) — long before that parked call has actually finished
 * doing the real work the human just approved. "Done." can fire before the real operation has even
 * started.
 *
 * `McpUiSurfaceCard`'s own doc (`@jini-ai/chat`) already names the fix this builder exists to use:
 * "a stream may re-send an updated document for a surface already on screen (a confirmation that
 * became a result), so the LAST event for each URI wins." A caller that finishes a confirmed action
 * re-emits THIS builder's resource under the SAME `ui://` URI the confirmation used, and the
 * transcript replaces the dialog with the real result in place — no second frame, and (since
 * `McpUiHost` keys its iframe by `sessionKey`, which defaults to the document text) no leftover
 * Confirm/Cancel buttons a human could click again on a request that already ran.
 *
 * ## Why this is not `ConfirmationSurfaceSpec` with `confirm` made optional
 *
 * A confirmation's whole shape exists to hold a token the model must never read and to let a human
 * ANSWER something. A result has already been answered — there is nothing left to confirm, cancel,
 * or submit, so `confirm`/`cancel`'s tool-call plumbing has no honest value here. Reusing that type
 * would mean either fabricating a placeholder `confirm` nobody should click, or forking the type at
 * every call site into "sometimes required, sometimes not" — worse than a small, purpose-built
 * sibling that carries only what a result needs.
 *
 * ## The one interactive element this DOES carry
 *
 * `openLinkUrl` renders a single button wired to the bridge's existing `openLink` (`ui/open-link`) —
 * no new bridge plumbing: a `<a href>` is dead inside this package's sandboxed `srcdoc` frame (no
 * `allow-top-navigation`), so `openLink` is the only way an isolated frame can navigate anything at
 * all (`bridge.ts`'s own header). The URL is ALSO always rendered as a plain detail row regardless —
 * copyable/selectable text that needs no script to be useful, matching this package's general
 * "the document should say something true even if a caller never runs its script" posture.
 */
import { createUIResource, type UIResource, type UIResourceUri } from '../resource.js';
import { escapeHtml, escapeJsValue } from '../escape.js';
import {
  renderActions,
  renderDetailList,
  renderStatusRegion,
  renderSurfaceDocument,
  renderSurfaceHeader,
  SURFACE_SCRIPT_PRELUDE,
  SURFACE_STATUS_ELEMENT_ID,
  type SurfaceDetail,
} from './document.js';
import type { BridgeScriptSpec } from './bridge.js';
import type { SurfaceTokenName } from './tokens.js';

export interface SurfaceOutcomeSpec {
  readonly title: string;
  readonly description?: string;
  /** The facts of what actually happened — same shape as a confirmation's own `details`, but
   *  reporting the RESULT (e.g. the real URL, the real status) rather than what was proposed. */
  readonly details?: readonly SurfaceDetail[];
  /**
   * Styles the status line and, when {@link openLinkUrl} is also present, the open-link button.
   * THREE states, not a boolean — matching this package's own callers, which distinguish a genuine
   * partial outcome (e.g. Tovu's static-publish "uploaded, but not yet confirmed reachable") from
   * both a plain success and a plain failure specifically so neither is misreported: folding
   * `'partial'` into `'success'` would claim something is live when it may not be reachable yet;
   * folding it into `'failure'` would hide that the operation itself did NOT fail (nothing needs
   * retrying, only a separate follow-up step). See `document.ts`'s own `[data-state="partial"]` rule
   * for why this needs a third visual state as well as a third value here, not merely a third string
   * that renders identically to one of the other two.
   */
  readonly state: 'success' | 'partial' | 'failure';
  /** The one human-facing sentence explaining the outcome — the actionable message on failure, or a
   *  short confirmation on success. Never a raw credential or provider response body; that boundary
   *  is the CALLER's responsibility (this builder only renders what it is given). */
  readonly message: string;
  /** When present, renders one button ("Open site" by default) that calls the bridge's `openLink`.
   *  Only meaningful alongside `state: 'success'` — a caller should not supply this for a failure. */
  readonly openLinkUrl?: string;
  readonly openLinkLabel?: string;
  /** Identity reported to the Host in `ui/initialize`. Defaults to a generic one. */
  readonly app?: BridgeScriptSpec;
  readonly lang?: string;
  readonly tokens?: Partial<Record<SurfaceTokenName, string>>;
}

const DEFAULT_APP: BridgeScriptSpec = { appName: 'jini-mcp-ui-outcome', appVersion: '1' };
const DEFAULT_OPEN_LINK_LABEL = 'Open site';
const OPEN_LINK_ACTION_ID = 'open-link';

/**
 * Renders the outcome document as a complete, self-contained HTML document.
 *
 * @param spec - See {@link SurfaceOutcomeSpec}.
 * @returns The full HTML string.
 * @complexity O(n) in the rendered length.
 */
export function renderOutcomeDocument(spec: SurfaceOutcomeSpec): string {
  const statusState = spec.state === 'success' ? 'done' : spec.state === 'partial' ? 'partial' : 'failed';
  // Rendered directly into the status region rather than left for the script to set — this document
  // has nothing further to wait on (unlike a confirmation, which starts idle and only reaches "done"
  // after a click), so the true outcome should be visible from the FIRST paint, not a moment after
  // the script runs.
  const statusHtml = `<p class="mcpui-status" id="${SURFACE_STATUS_ELEMENT_ID}" role="status" aria-live="polite" data-state="${statusState}">${escapeHtml(spec.message)}</p>`;

  const hasOpenLink = spec.openLinkUrl !== undefined;
  const actionsHtml = hasOpenLink
    ? renderActions([{ id: OPEN_LINK_ACTION_ID, label: spec.openLinkLabel ?? DEFAULT_OPEN_LINK_LABEL, variant: spec.state === 'success' ? 'primary' : 'neutral' }])
    : '';

  const bodyHtml = [
    renderSurfaceHeader(spec.description === undefined ? { title: spec.title } : { title: spec.title, description: spec.description }),
    renderDetailList(spec.details ?? []),
    statusHtml,
    actionsHtml,
  ]
    .filter((fragment) => fragment !== '')
    .join('\n');

  const script = hasOpenLink
    ? `(function () {
  "use strict";
${SURFACE_SCRIPT_PRELUDE}
  var OPEN_URL = ${escapeJsValue(spec.openLinkUrl)};
  for (var i = 0; i < actionButtons.length; i++) {
    actionButtons[i].addEventListener("click", function () { api.openLink(OPEN_URL); });
  }
}());`
    // No prelude at all when there is nothing to wire up — a pure-display result needs no bridge
    // calls and no `[data-mcpui-action]` scan.
    : '(function () { "use strict"; }());';

  return renderSurfaceDocument({
    title: spec.title,
    bodyHtml,
    script,
    app: spec.app ?? DEFAULT_APP,
    ...(spec.lang === undefined ? {} : { lang: spec.lang }),
    ...(spec.tokens === undefined ? {} : { tokens: spec.tokens }),
  });
}

/**
 * Renders the outcome document as an MCP-UI resource, ready to re-send under the SAME `ui://` URI a
 * prior confirmation/form used for this exchange — see this module's header for why that URI reuse
 * is the whole mechanism.
 *
 * @param spec.uri - MUST equal the URI of the surface being replaced (typically derived from the
 * same exchange id) — a different URI would render as a SECOND, separate card rather than replacing
 * the first.
 * @complexity O(n) in the rendered length.
 */
export function buildOutcomeSurface(spec: SurfaceOutcomeSpec & { uri: UIResourceUri; preferredFrameSize?: readonly [string, string] }): UIResource {
  return createUIResource({
    uri: spec.uri,
    htmlString: renderOutcomeDocument(spec),
    ...(spec.preferredFrameSize === undefined ? {} : { preferredFrameSize: spec.preferredFrameSize }),
    // No `actionPlan`: unlike a confirmation, this surface has nothing PENDING for
    // `page.find_elements`'s parent-DOM mirror to describe (`McpUiSurfaceCard`'s own
    // `readActionPlan`/`PendingSurfaceMirror` — that mirror exists for a confirmation a human has not
    // yet answered; a result has already been answered).
  });
}
