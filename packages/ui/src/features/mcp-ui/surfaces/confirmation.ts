/**
 * @module features/mcp-ui/surfaces/confirmation
 *
 * The confirmation dialog: a title, a description, the facts the human is being asked to agree
 * about, and two buttons — one of which calls a tool.
 *
 * Generalized from the reference implementation's `delete-confirmation-ui.ts`, which is the same
 * dialog hardcoded to one domain (its noun is "post" or "page", its fields are title/slug/kind/status/id,
 * and its tool id is a module constant). Everything domain-shaped there is a parameter here: the
 * facts are a `{label, value}` list, the destructive framing is a flag, and both buttons name their
 * own tool and params.
 *
 * ## The property this builder is built around
 *
 * A confirmation whose secret the model can read is theater. `confirmation-store.ts` explains the
 * arrangement; this builder is the half that keeps its end of it — the token is a value in
 * `confirm.params`, which is interpolated into the surface's inline script and nowhere else. The
 * `ui://` URI, the title, the details, and the model-readable text block of the tool result are all
 * places a token must never go, and none of them are reachable from `confirm.params`.
 *
 * ## Why cancel may also call a tool
 *
 * A cancel that only closes the dialog leaves a live, unredeemed token behind until it expires.
 * Giving `cancel` its own tool call (with the same token and a `decision: "cancel"` param, the shape
 * the reference implementation uses) lets the server burn it immediately, so "cancel" genuinely
 * closes the window rather
 * than deferring it by the TTL. It stays optional because a non-destructive confirmation has nothing
 * to burn.
 */
import { createUIResource, type UIResource, type UIResourceUri } from '../resource.js';
import { escapeHtml, escapeJsValue } from '../escape.js';
import {
  DEFAULT_SURFACE_STATUS_TEXT,
  SURFACE_SCRIPT_PRELUDE,
  renderActions,
  renderDetailList,
  renderStatusRegion,
  renderSurfaceDocument,
  renderSurfaceHeader,
  type SurfaceAction,
  type SurfaceDetail,
  type SurfaceStatusText,
} from './document.js';
import type { BridgeScriptSpec } from './bridge.js';
import type { SurfaceTokenName } from './tokens.js';

/** A button that calls a tool when clicked. */
export interface ConfirmationToolAction {
  readonly label: string;
  readonly toolName: string;
  /** Passed verbatim as the tool's `arguments`. The only safe home for a confirmation token. */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ConfirmationSurfaceSpec {
  readonly title: string;
  readonly description?: string;
  /** The facts being agreed about. A dialog that says "delete this?" without naming *this* is not consent. */
  readonly details?: readonly SurfaceDetail[];
  /** A callout above the buttons — the consequence that is not obvious from the details alone. */
  readonly warning?: string;
  /** Styles the affirmative button as destructive. Affects presentation only; it changes no behavior. */
  readonly danger?: boolean;
  readonly confirm: ConfirmationToolAction;
  /** Omit for a dialog whose cancel only dismisses. Give it a tool to burn a pending token server-side. */
  readonly cancel?: ConfirmationToolAction | { readonly label: string };
  /** Runtime strings. Partially overridable; anything omitted keeps its English default. */
  readonly text?: Partial<SurfaceStatusText>;
  /** Identity reported to the Host in `ui/initialize`. Defaults to a generic one. */
  readonly app?: BridgeScriptSpec;
  readonly lang?: string;
  readonly tokens?: Partial<Record<SurfaceTokenName, string>>;
}

const DEFAULT_APP: BridgeScriptSpec = { appName: 'jini-mcp-ui-confirmation', appVersion: '1' };

function isToolAction(action: ConfirmationSurfaceSpec['cancel']): action is ConfirmationToolAction {
  return action !== undefined && 'toolName' in action;
}

/**
 * Renders the confirmation dialog as a complete, self-contained HTML document.
 *
 * @param spec - See {@link ConfirmationSurfaceSpec}.
 * @returns The full HTML string.
 * @complexity O(n) in the rendered length.
 */
export function renderConfirmationDocument(spec: ConfirmationSurfaceSpec): string {
  const text = { ...DEFAULT_SURFACE_STATUS_TEXT, ...spec.text };
  const actions: SurfaceAction[] = [
    { id: 'confirm', label: spec.confirm.label, variant: spec.danger === true ? 'danger' : 'primary' },
  ];
  if (spec.cancel !== undefined) actions.push({ id: 'cancel', label: spec.cancel.label, variant: 'neutral' });

  const warning = spec.warning === undefined ? '' : `<p class="mcpui-warning">${escapeHtml(spec.warning)}</p>`;
  const bodyHtml = [
    renderSurfaceHeader(
      spec.description === undefined ? { title: spec.title } : { title: spec.title, description: spec.description },
    ),
    renderDetailList(spec.details ?? []),
    warning,
    renderActions(actions),
    renderStatusRegion(),
  ]
    .filter((fragment) => fragment !== '')
    .join('\n');

  // A map from button id to what that button does. `null` means "dismiss locally, call nothing" —
  // the shape a cancel-without-a-tool takes, kept as an explicit null rather than an absent key so
  // the script can tell "this button dismisses" from "this button is unknown to me".
  const plan: Record<string, { toolName: string; params: Readonly<Record<string, unknown>> } | null> = {
    confirm: { toolName: spec.confirm.toolName, params: spec.confirm.params },
  };
  if (spec.cancel !== undefined) {
    plan['cancel'] = isToolAction(spec.cancel)
      ? { toolName: spec.cancel.toolName, params: spec.cancel.params }
      : null;
  }

  const script = `(function () {
  "use strict";
${SURFACE_SCRIPT_PRELUDE}
  var PLAN = ${escapeJsValue(plan)};
  var TEXT = ${escapeJsValue(text)};

  for (var i = 0; i < actionButtons.length; i++) {
    actionButtons[i].addEventListener("click", onClick);
  }

  function onClick(event) {
    var step = PLAN[event.currentTarget.getAttribute("data-mcpui-action")];
    if (step === undefined) return;
    if (step === null) {
      setBusy(true);
      setStatus(TEXT.dismissed, "dismissed");
      api.requestTeardown();
      return;
    }
    setBusy(true);
    setStatus(TEXT.working, "pending");
    api.callTool(step.toolName, step.params).then(function () {
      setStatus(TEXT.done, "done");
      api.requestTeardown();
    }, function (error) {
      // Re-enabled on failure: a rejected call did not happen, so the human must be able to retry
      // or cancel rather than be left with a dead dialog reporting an error it cannot act on.
      setBusy(false);
      setStatus(TEXT.failedPrefix + describeError(error), "failed");
    });
  }
}());`;

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
 * Renders the confirmation dialog as an MCP-UI resource, ready for a tool result's `content` array.
 *
 * @param spec.uri - The `ui://` identifier. Key it by entity and version, never by the confirmation
 * token: a URI is something a host may log, cache, or show in devtools.
 * @param spec.preferredFrameSize - `[width, height]` hint for hosts that honor it.
 * @complexity O(n) in the rendered length.
 */
export function buildConfirmationSurface(
  spec: ConfirmationSurfaceSpec & {
    uri: UIResourceUri;
    preferredFrameSize?: readonly [string, string];
  },
): UIResource {
  return createUIResource({
    uri: spec.uri,
    htmlString: renderConfirmationDocument(spec),
    ...(spec.preferredFrameSize === undefined ? {} : { preferredFrameSize: spec.preferredFrameSize }),
  });
}
