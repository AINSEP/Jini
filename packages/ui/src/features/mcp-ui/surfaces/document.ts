/**
 * @module features/mcp-ui/surfaces/document
 *
 * The document shell every generated surface is built from: doctype, head, the first `<style>` tag
 * carrying the complete token block, the body wrapper, the protocol bridge, and the surface's own
 * script — in that order, once, so no builder hand-rolls `<!doctype html>` boilerplate and no
 * builder can accidentally ship a document whose tokens are half-declared.
 *
 * Also here: the small shared fragments (`header`, `detail list`, `status region`, `actions`) that
 * every dialog-shaped surface needs. They live with the shell rather than in the individual
 * builders because the CSS that styles them lives here — splitting the markup from the only
 * stylesheet that can reach it is how a "generic" fragment quietly becomes unstyled in one caller.
 */
import { AGENT_ELEMENT_ATTRIBUTE, AGENT_LABEL_ATTRIBUTE, AGENT_ROLE_ATTRIBUTE } from '@jini-ai/agentic';
import { escapeHtml } from '../escape.js';
import { SURFACE_BRIDGE_GLOBAL, renderBridgeScript, type BridgeScriptSpec } from './bridge.js';
import { renderTokenBlock, type SurfaceTokenName } from './tokens.js';

/**
 * The base stylesheet, applied after the token block.
 *
 * Every rule resolves through a token declared by {@link renderTokenBlock} — there is no external
 * stylesheet to inherit from and no host cascade to fall back to, so a hardcoded color here would
 * be a color no caller could reskin. `var(--x, fallback)` appears only where a value is genuinely
 * optional.
 */
export const SURFACE_BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  /* Transparent, not var(--jini-mcpui-bg): this document has no page of its own to paint. It is an
     allow-scripts-only sandboxed iframe embedded directly in a host's chat transcript, and html's
     background is left at its (also transparent) initial value, so the host's own pane shows
     straight through to .mcpui-surface below rather than through a second, unrelated rectangle of
     fill color sitting between the two. --jini-mcpui-bg stays declared for a caller styling
     something else via extraCss -- nothing in this stylesheet reads it anymore. */
  background: transparent;
  color: var(--jini-mcpui-text);
  font-family: var(--jini-mcpui-font);
  font-size: 14px;
  line-height: 1.5;
  padding: 16px;
  -webkit-font-smoothing: antialiased;
}
.mcpui-surface {
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--jini-mcpui-accent) 5%, var(--jini-mcpui-panel)) 0%,
    var(--jini-mcpui-panel) 60%);
  border: 1px solid color-mix(in srgb, var(--jini-mcpui-accent) 18%, var(--jini-mcpui-border));
  border-radius: var(--jini-mcpui-radius-md);
  box-shadow: var(--jini-mcpui-surface-shadow);
  padding: 18px 20px 16px;
  max-width: 640px;
  margin: 0 auto;
}
.mcpui-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--jini-mcpui-text-strong);
}
.mcpui-description { margin: 6px 0 0; color: var(--jini-mcpui-text-muted); }
.mcpui-details {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 14px;
  margin: 14px 0 0;
}
.mcpui-details dt { color: var(--jini-mcpui-text-soft); font-weight: 500; }
.mcpui-details dd { margin: 0; overflow-wrap: anywhere; color: var(--jini-mcpui-text); }
.mcpui-warning {
  margin: 14px 0 0;
  padding: 9px 11px;
  border-radius: var(--jini-mcpui-radius-md);
  border: 1px solid var(--jini-mcpui-danger);
  background: var(--jini-mcpui-danger-tint);
  color: var(--jini-mcpui-text-strong);
}
.mcpui-fields { display: flex; flex-direction: column; gap: 12px; margin: 16px 0 0; border: 0; padding: 0; }
.mcpui-field { display: flex; flex-direction: column; gap: 4px; }
.mcpui-field-inline { flex-direction: row; align-items: flex-start; gap: 8px; }
.mcpui-label { font-weight: 500; color: var(--jini-mcpui-text-strong); }
.mcpui-required { color: var(--jini-mcpui-accent); margin-left: 2px; }
.mcpui-hint { color: var(--jini-mcpui-text-soft); font-size: 13px; }
.mcpui-input, .mcpui-select, .mcpui-textarea {
  font: inherit;
  color: var(--jini-mcpui-text);
  background: var(--jini-mcpui-panel);
  border: 1px solid color-mix(in srgb, var(--jini-mcpui-accent) 14%, var(--jini-mcpui-border-strong));
  border-radius: var(--jini-mcpui-radius-sm);
  padding: 7px 9px;
  width: 100%;
  min-width: 0;
}
.mcpui-textarea { resize: vertical; min-height: 72px; font-family: var(--jini-mcpui-font); }
.mcpui-checkbox { margin: 3px 0 0; accent-color: var(--jini-mcpui-accent); }
.mcpui-choice-group { border: 0; padding: 0; margin: 0; min-width: 0; }
.mcpui-choice { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; margin: 6px 0 0; }
.mcpui-choice-label { color: var(--jini-mcpui-text); font-weight: 400; }
.mcpui-input:focus-visible, .mcpui-select:focus-visible, .mcpui-textarea:focus-visible,
.mcpui-checkbox:focus-visible, .mcpui-button:focus-visible {
  outline: 2px solid var(--jini-mcpui-accent-ring);
  outline-offset: 1px;
  border-color: var(--jini-mcpui-accent);
}
.mcpui-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
.mcpui-button {
  font: inherit;
  font-weight: 500;
  padding: 7px 15px;
  border-radius: var(--jini-mcpui-radius-pill);
  border: 1px solid color-mix(in srgb, var(--jini-mcpui-accent) 14%, var(--jini-mcpui-border-strong));
  background: var(--jini-mcpui-panel);
  color: var(--jini-mcpui-text);
  cursor: pointer;
}
.mcpui-button:hover:not([disabled]) { background: var(--jini-mcpui-accent-tint); }
.mcpui-button-primary {
  background: var(--jini-mcpui-accent);
  border-color: var(--jini-mcpui-accent);
  color: var(--jini-mcpui-panel);
}
.mcpui-button-primary:hover:not([disabled]) { background: var(--jini-mcpui-accent-hover); border-color: var(--jini-mcpui-accent-hover); }
.mcpui-button-danger {
  background: var(--jini-mcpui-danger);
  border-color: var(--jini-mcpui-danger);
  color: var(--jini-mcpui-panel);
}
.mcpui-button-danger:hover:not([disabled]) { background: var(--jini-mcpui-danger-hover); border-color: var(--jini-mcpui-danger-hover); }
.mcpui-button[disabled] { opacity: 0.55; cursor: default; }
.mcpui-status { margin: 12px 0 0; min-height: 1.4em; color: var(--jini-mcpui-text-muted); }
.mcpui-status[data-state="failed"], .mcpui-status[data-state="invalid"] { color: var(--jini-mcpui-danger); }
.mcpui-status[data-state="done"] { color: var(--jini-mcpui-text-strong); }
/* Neither a plain success nor a failure — e.g. an outcome surface reporting "uploaded, not yet
   reachable" (outcome.ts's own state: partial). Distinct from both --jini-mcpui-danger (would
   wrongly read as "this failed") and --jini-mcpui-text-strong (would wrongly read as "this is
   fully done"); the accent token reads as "worth a second look" without asserting either. */
.mcpui-status[data-state="partial"] { color: var(--jini-mcpui-accent); }
.mcpui-code { font-family: var(--jini-mcpui-font-mono); font-size: 13px; color: var(--jini-mcpui-text-faint); }`;

/**
 * The Content-Security-Policy every generated surface declares in its own `<head>`.
 *
 * The sandbox attribute (`MCP_UI_VIEW_SANDBOX`) already denies the frame an origin, forms, popups,
 * and top-level navigation. What it does not deny is *outbound network access*: a sandboxed frame
 * can still `fetch()`, load an image, or open a WebSocket, which is a working exfiltration channel
 * for whatever the surface was told — and a confirmation dialog is told, by design, a secret the
 * model is not allowed to have. `default-src 'none'` closes it: no subresource of any kind, from
 * any origin, including the frame's own.
 *
 * `'unsafe-inline'` for scripts and styles is not a weakening of that. Inline is the *only* way a
 * `srcdoc` document can carry code or styling at all — there is no origin to serve a file from — so
 * the alternative to allowing it is a document with neither. What matters is that the inline content
 * is generated by this package from typed props, and that with `default-src 'none'` it has nowhere
 * to send anything.
 */
export const SURFACE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

export interface SurfaceDocumentSpec {
  /** The document `<title>`. Also what a host shows if it labels the frame. */
  readonly title: string;
  /** The body of `.mcpui-surface`. Already-escaped HTML — builders escape at the point they interpolate. */
  readonly bodyHtml: string;
  /** The surface's own script, run after the bridge. Reaches the protocol through `window.jiniMcpUi`. */
  readonly script: string;
  /** Identity reported to the Host in `ui/initialize`. */
  readonly app: BridgeScriptSpec;
  /** `<html lang>`. Defaults to `'en'`; pass the host's locale for a surface with translated text. */
  readonly lang?: string;
  /** Base design tokens to override — see `tokens.ts`. */
  readonly tokens?: Partial<Record<SurfaceTokenName, string>>;
  /** Extra CSS, appended after {@link SURFACE_BASE_CSS} so it can override it. */
  readonly extraCss?: string;
}

/**
 * Assembles a complete, self-contained surface document.
 *
 * @param spec - See {@link SurfaceDocumentSpec}.
 * @returns The full HTML string, suitable for `createUIResource`'s `htmlString` and, on the host
 * side, for an iframe's `srcdoc`.
 * @complexity O(n) in the assembled length.
 */
export function renderSurfaceDocument(spec: SurfaceDocumentSpec): string {
  const extraCss = spec.extraCss === undefined ? '' : `\n${spec.extraCss}`;
  return `<!doctype html>
<html lang="${escapeHtml(spec.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SURFACE_CSP}">
<title>${escapeHtml(spec.title)}</title>
<style>
${renderTokenBlock(spec.tokens)}
${SURFACE_BASE_CSS}${extraCss}
</style>
</head>
<body>
<main class="mcpui-surface">
${spec.bodyHtml}
</main>
<script>
${renderBridgeScript(spec.app)}
</script>
<script>
${spec.script}
</script>
</body>
</html>`;
}

/**
 * Renders a surface's heading and optional description.
 *
 * @param spec.title - Shown as the `<h1>`. There is exactly one per surface — a frame this small
 * has no room for a heading hierarchy, and a screen reader reaching a one-heading document announces
 * it as the frame's purpose.
 */
export function renderSurfaceHeader(spec: { title: string; description?: string }): string {
  const description =
    spec.description === undefined ? '' : `\n<p class="mcpui-description">${escapeHtml(spec.description)}</p>`;
  return `<h1 class="mcpui-title">${escapeHtml(spec.title)}</h1>${description}`;
}

/** One row of a surface's detail list. */
export interface SurfaceDetail {
  readonly label: string;
  readonly value: string;
}

/**
 * Renders a `label: value` description list.
 *
 * @returns The `<dl>`, or `''` for an empty list — an empty `<dl>` is announced by screen readers
 * as a list with no items, which is worse than no list.
 */
export function renderDetailList(details: readonly SurfaceDetail[]): string {
  if (details.length === 0) return '';
  const rows = details
    .map((detail) => `  <dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd>`)
    .join('\n');
  return `<dl class="mcpui-details">\n${rows}\n</dl>`;
}

/** Renders the polite live region every surface reports outcomes through. Its id is fixed so surface scripts can find it. */
export function renderStatusRegion(): string {
  return `<p class="mcpui-status" id="${SURFACE_STATUS_ELEMENT_ID}" role="status" aria-live="polite" data-state="idle"></p>`;
}

/** The id {@link renderStatusRegion} emits and {@link SURFACE_SCRIPT_PRELUDE} looks up. */
export const SURFACE_STATUS_ELEMENT_ID = 'mcpui-status';

/**
 * Every user-visible string a surface's script writes at runtime.
 *
 * Surfaces are HTML strings built outside React, so `features/i18n`'s `useT` cannot reach them — a
 * translated surface is one whose builder was handed translated text. These are the defaults for a
 * caller that has none.
 */
export interface SurfaceStatusText {
  /** Shown while a tool call is in flight. */
  readonly working: string;
  /** Shown when the call resolves. */
  readonly done: string;
  /** Prefixed to the Host's own error message when the call rejects. */
  readonly failedPrefix: string;
  /** Shown when the human dismisses a surface that has no cancel tool to call. */
  readonly dismissed: string;
  /** Prefixed to the comma-joined labels of unfilled required fields. */
  readonly missingPrefix: string;
}

export const DEFAULT_SURFACE_STATUS_TEXT: SurfaceStatusText = {
  working: 'Working…',
  done: 'Done.',
  failedPrefix: 'Failed: ',
  dismissed: 'Dismissed.',
  missingPrefix: 'Please complete: ',
};

/**
 * The JavaScript preamble every surface script opens with: the bridge handle, the status region,
 * the action buttons, and the two helpers (`setStatus`, `setBusy`) that would otherwise be
 * copy-pasted into each builder — and would then drift, so that one dialog disabled its buttons
 * while another left them live for a second click on an in-flight destructive action.
 *
 * Declared with `var` and function declarations rather than `const`/arrow functions to match the
 * rest of the emitted scripts: these run as classic scripts in whatever engine the host embeds, and
 * the builders make no assumption about it beyond ES5.
 */
export const SURFACE_SCRIPT_PRELUDE = `var api = window.${SURFACE_BRIDGE_GLOBAL};
var statusNode = document.getElementById(${JSON.stringify(SURFACE_STATUS_ELEMENT_ID)});
var actionButtons = Array.prototype.slice.call(document.querySelectorAll("[data-mcpui-action]"));
function setStatus(text, state) {
  statusNode.textContent = text;
  statusNode.setAttribute("data-state", state);
}
function setBusy(busy) {
  for (var i = 0; i < actionButtons.length; i++) actionButtons[i].disabled = busy;
}
function describeError(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}`;

/**
 * A field name that is simultaneously an HTML `name`, part of a DOM `id`, and a key in the JSON
 * params object the surface posts back. Anything outside this set breaks at least one of those
 * three silently — a space in a `name` produces an `id` the `for` attribute cannot reference, so
 * clicking the label stops focusing the control and nothing reports an error.
 */
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Builds the DOM id for a field's control, validating the name on the way through.
 *
 * @throws If the name is not a valid field name. Thrown rather than sanitized, because silently
 * rewriting a caller's field name would change the key of the params the tool receives.
 */
export function fieldElementId(name: string): string {
  if (!FIELD_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid MCP-UI field name ${JSON.stringify(name)}: expected /${FIELD_NAME_PATTERN.source}/.`);
  }
  return `mcpui-field-${name}`;
}

/**
 * Renders a control's `<label>`, plus its optional hint.
 *
 * @param spec.inline - `true` for a checkbox, where the label follows the control rather than
 * sitting above it, so the hint has to be wrapped instead of emitted as a sibling.
 */
export function renderFieldLabel(spec: {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
}): string {
  const required = spec.required === true ? '<span class="mcpui-required" aria-hidden="true">*</span>' : '';
  const hint =
    spec.hint === undefined
      ? ''
      : `\n<span class="mcpui-hint" id="${escapeHtml(fieldElementId(spec.name))}-hint">${escapeHtml(spec.hint)}</span>`;
  return `<label class="mcpui-label" for="${escapeHtml(fieldElementId(spec.name))}">${escapeHtml(spec.label)}${required}</label>${hint}`;
}

/** The `aria-describedby` attribute pointing at a field's hint, or `''` when it has none. */
export function fieldDescribedBy(spec: { name: string; hint?: string }): string {
  if (spec.hint === undefined) return '';
  return ` aria-describedby="${escapeHtml(fieldElementId(spec.name))}-hint"`;
}

/** One button in a surface's action row. */
export interface SurfaceAction {
  /** Written to `data-mcpui-action`; the surface script dispatches on it. */
  readonly id: string;
  readonly label: string;
  /** `primary` for the affirmative action, `danger` for a destructive one, `neutral` for cancel. */
  readonly variant?: 'primary' | 'danger' | 'neutral';
  /**
   * `submit` triggers native `<form>` submission on click — which every surface in this package
   * avoids. In the sandbox these documents actually render in (`allow-scripts`, no `allow-forms`),
   * a native form submission is blocked before the browser ever dispatches the `submit` event, so a
   * `type="submit"` button inside a `<form>` there is inert by construction and any handler wired to
   * `submit` is unreachable dead code — see `form.ts`'s `runSubmit`, which is called from `click`
   * instead. Kept as an option here, not removed, for a caller embedding this HTML somewhere other
   * than that sandbox; every current builder passes `button` (the default).
   */
  readonly type?: 'button' | 'submit';
}

/**
 * Renders the action row.
 *
 * Buttons carry `data-mcpui-action`, never an `onclick` attribute: an inline handler would need a
 * `script-src 'unsafe-inline'`-equivalent allowance for attributes specifically, and a host is free
 * to apply a stricter CSP to the frame than this package can see.
 *
 * Each button also carries the `@jini-ai/agentic` `data-agent-*` markup convention
 * ({@link AGENT_ELEMENT_ATTRIBUTE} et al.) — but this tagging is advisory, not the thing that makes
 * a surface's actions reachable by `page.find_elements`/`page.click`. Those capabilities resolve a
 * handle by scanning `document`/`contentDocument`, and this document renders inside a `srcdoc`
 * iframe sandboxed to `allow-scripts` alone (`MCP_UI_VIEW_SANDBOX` — no `allow-same-origin`,
 * deliberately), which gives it an opaque origin no ancestor document can read into. So this tagging
 * is real for a driver that reaches INTO the frame directly — `frameLocator` in Playwright, proven
 * end to end against exactly this markup — and inert for anything scanning the parent page. Making a
 * surface's actions visible to `page.find_elements` needs a second, parent-DOM-side echo of this
 * same action list; see `McpUiSurfaceCard` in `@jini-ai/chat` for that half.
 */
export function renderActions(actions: readonly SurfaceAction[]): string {
  const buttons = actions
    .map((action) => {
      const variant = action.variant ?? 'neutral';
      const variantClass = variant === 'neutral' ? '' : ` mcpui-button-${variant}`;
      const label = escapeHtml(action.label);
      // `mcpui-action-<id>` rather than the bare id: every id observed across this package's own
      // builders ('confirm', 'cancel', 'submit') already satisfies the agentic package's stricter
      // `[a-z0-9]+(-[a-z0-9]+)*` handle pattern, but `SurfaceAction.id` is typed as a plain `string`
      // and nothing here enforces that — a future builder passing something else would still produce
      // syntactically valid, HTML-escaped markup, just not necessarily a handle `resolveHandleSelector`
      // would accept. That is unenforced on purpose (see the function doc above: `page.find_elements`
      // can never reach this document to resolve it either way), so failing loudly here would refuse
      // markup for a reason that can never matter to the one consumer that can actually query it.
      return `  <button type="${action.type ?? 'button'}" class="mcpui-button${variantClass}" data-mcpui-action="${escapeHtml(action.id)}" ${AGENT_ELEMENT_ATTRIBUTE}="mcpui-action-${escapeHtml(action.id)}" ${AGENT_ROLE_ATTRIBUTE}="button" ${AGENT_LABEL_ATTRIBUTE}="${label}">${label}</button>`;
    })
    .join('\n');
  return `<div class="mcpui-actions">\n${buttons}\n</div>`;
}
