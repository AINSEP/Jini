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
import { renderCheckbox } from './checkbox.js';
import type { BridgeScriptSpec } from './bridge.js';
import type { SurfaceTokenName } from './tokens.js';

/** A button that calls a tool when clicked. */
export interface ConfirmationToolAction {
  readonly label: string;
  readonly toolName: string;
  /** Passed verbatim as the tool's `arguments`. The only safe home for a confirmation token. */
  readonly params: Readonly<Record<string, unknown>>;
}

/** One row of an optional per-item checkbox list — see {@link ConfirmationSurfaceSpec.choices}. */
export interface ConfirmationChoice {
  /**
   * The value reported back when this box is ticked. Caller data, not a DOM name: it may contain
   * any character, because it never becomes an HTML `name`/`id` (those are `choice-<index>` in the
   * DOM; see `renderChoices`) — only a `data-mcpui-choice` attribute value, which any string escapes
   * into safely.
   */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface ConfirmationSurfaceSpec {
  readonly title: string;
  readonly description?: string;
  /** The facts being agreed about. A dialog that says "delete this?" without naming *this* is not consent. */
  readonly details?: readonly SurfaceDetail[];
  /**
   * Optional per-row checkboxes, rendered unchecked between the details and the warning. Ticking one
   * never confirms anything by itself — the same property the module doc opens with, extended to a
   * second input: a tick reaches a tool call ONLY by riding along on confirm's own trusted,
   * past-dwell click, merged into {@link ConfirmationToolAction.params} under {@link choicesParam}
   * at the moment of that click and never before. With no `choices`, the rendered document and the
   * params confirm posts are byte-identical to a spec written before this field existed.
   */
  readonly choices?: readonly ConfirmationChoice[];
  /**
   * The params key the ticked ids are posted under, merged into (never replacing) `confirm.params`.
   * Defaults to `"overwrite"`.
   */
  readonly choicesParam?: string;
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

/**
 * How long the dialog must have been visible before a confirm click counts, in ms. A click sooner
 * than a person could have read the dialog is ignored — the same dwell browsers put on permission
 * prompts against clickjacking, and a guard against an automated click racing the render. Longer
 * than the ~1 s render-to-confirm gap of the incident it was added for. The confirm button is
 * rendered disabled and enabled when the dwell ends, so a person sees why an early click does nothing.
 */
export const CONFIRM_DWELL_MS = 1500;

const DEFAULT_APP: BridgeScriptSpec = { appName: 'jini-mcp-ui-confirmation', appVersion: '1' };

function isToolAction(action: ConfirmationSurfaceSpec['cancel']): action is ConfirmationToolAction {
  return action !== undefined && 'toolName' in action;
}

/**
 * Renders the optional choice checkboxes, one unchecked box per {@link ConfirmationChoice}.
 *
 * Named `choice-<index>` in the DOM — never by `choice.id`, which is caller data and may contain
 * characters `fieldElementId`'s `name` validation rejects — with the real id carried on the
 * `data-mcpui-choice` attribute instead, which the script reads back on change.
 *
 * @returns `''` for an empty list, matching every other optional fragment in this document.
 */
function renderChoices(choices: readonly ConfirmationChoice[]): string {
  if (choices.length === 0) return '';
  // Ticked state is keyed by id, so two boxes sharing one would tick and report as one.
  const seen = new Set<string>();
  for (const choice of choices) {
    if (seen.has(choice.id)) {
      throw new Error(`Confirmation choices must have unique ids; ${JSON.stringify(choice.id)} appears more than once.`);
    }
    seen.add(choice.id);
  }
  const boxes = choices
    .map((choice, index) =>
      renderCheckbox({
        name: `choice-${index}`,
        label: choice.label,
        ...(choice.hint === undefined ? {} : { hint: choice.hint }),
        dataAttribute: { name: 'data-mcpui-choice', value: choice.id },
      }),
    )
    .join('\n');
  // Reuses form.ts's `.mcpui-fields` spacing rather than inventing a second stylesheet rule for the
  // same "stack of controls" layout.
  return `<fieldset class="mcpui-fields">\n${boxes}\n</fieldset>`;
}

/**
 * Renders the confirmation dialog as a complete, self-contained HTML document.
 *
 * @param spec - See {@link ConfirmationSurfaceSpec}.
 * @returns The full HTML string.
 * @complexity O(n) in the rendered length.
 */
/**
 * The confirm/cancel action list a confirmation spec implies — shared between
 * {@link renderConfirmationDocument} (which renders these as real, in-frame buttons) and
 * {@link buildConfirmationSurface} (which writes the same ids/labels/variants into the
 * `_meta` action plan a host mirrors outside the frame). One function, not two independently
 * maintained mappings: a caller adding a third action or renaming a label must not be able to
 * update the visible button without also updating what an agent-visible mirror reports for it.
 */
function confirmationActions(spec: ConfirmationSurfaceSpec): SurfaceAction[] {
  const actions: SurfaceAction[] = [
    { id: 'confirm', label: spec.confirm.label, variant: spec.danger === true ? 'danger' : 'primary' },
  ];
  if (spec.cancel !== undefined) actions.push({ id: 'cancel', label: spec.cancel.label, variant: 'neutral' });
  return actions;
}

export function renderConfirmationDocument(spec: ConfirmationSurfaceSpec): string {
  const text = { ...DEFAULT_SURFACE_STATUS_TEXT, ...spec.text };
  const choicesParam = spec.choicesParam ?? 'overwrite';
  // The ticked ids are merged into confirm.params at click time; a key already there (the token,
  // say) would be silently replaced by an array.
  if ((spec.choices ?? []).length > 0 && Object.prototype.hasOwnProperty.call(spec.confirm.params, choicesParam)) {
    throw new Error(`choicesParam ${JSON.stringify(choicesParam)} collides with a key already in confirm.params.`);
  }
  const actions = confirmationActions(spec);

  const warning = spec.warning === undefined ? '' : `<p class="mcpui-warning">${escapeHtml(spec.warning)}</p>`;
  const bodyHtml = [
    renderSurfaceHeader(
      spec.description === undefined ? { title: spec.title } : { title: spec.title, description: spec.description },
    ),
    renderDetailList(spec.details ?? []),
    renderChoices(spec.choices ?? []),
    warning,
    // Confirm starts disabled; the script enables it once the dwell has run out.
    renderActions(actions.map((action) => (action.id === 'confirm' ? { ...action, disabled: true } : action))),
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
  var DWELL_MS = ${CONFIRM_DWELL_MS};
  var CHOICES_PARAM = ${escapeJsValue(choicesParam)};

  // Monotonic where available: a wall clock set backwards would otherwise stretch the dwell.
  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }
  // Set while a call is in flight and for good once one settles the dialog. The disabled buttons
  // already block clicks in a browser; this makes the guarantee not depend on the DOM honoring that.
  var locked = false;

  // When the dialog last became visible; null while hidden. A dialog that loads in a background tab
  // has not been seen, so its dwell starts when it is shown, and restarts each time it is shown again.
  var visibleSince = null;
  var dwellTimer = null;
  var confirmButton = document.querySelector('[data-mcpui-action="confirm"]');

  function dwellDone() {
    return visibleSince !== null && now() - visibleSince >= DWELL_MS;
  }
  // Confirm is enabled exactly when the dwell has run out and no call holds the dialog.
  function syncConfirm() {
    if (confirmButton !== null && !locked) confirmButton.disabled = !dwellDone();
  }
  // Re-checks rather than trusts the timer: setTimeout and now() are different clocks, and a timer
  // that fired a hair early must not leave confirm disabled for good.
  function onDwellTimer() {
    dwellTimer = null;
    if (visibleSince === null) return;
    var left = DWELL_MS - (now() - visibleSince);
    if (left > 0) dwellTimer = setTimeout(onDwellTimer, left);
    else syncConfirm();
  }
  function onVisibilityChange() {
    if (dwellTimer !== null) clearTimeout(dwellTimer);
    dwellTimer = null;
    visibleSince = document.visibilityState === "hidden" ? null : now();
    syncConfirm();
    if (visibleSince !== null) dwellTimer = setTimeout(onDwellTimer, DWELL_MS);
  }
  onVisibilityChange();
  document.addEventListener("visibilitychange", onVisibilityChange);

  for (var i = 0; i < actionButtons.length; i++) {
    actionButtons[i].addEventListener("click", onClick);
  }

  // Ticked state, tracked ourselves rather than trusted from each input's own \`.checked\` at
  // confirm-time -- the same "only a browser-attributed action counts" rule \`onClick\` applies to
  // the buttons, extended to the one other interactive element this document can contain. Keyed by
  // \`data-mcpui-choice\` (the caller's id), not DOM order, so a checkbox reordering upstream could
  // never silently swap which id a tick reports.
  var choiceInputs = Array.prototype.slice.call(document.querySelectorAll("[data-mcpui-choice]"));
  var checkedIds = {};
  for (var c = 0; c < choiceInputs.length; c++) {
    choiceInputs[c].addEventListener("change", onChoiceChange);
  }

  function onChoiceChange(event) {
    var id = event.currentTarget.getAttribute("data-mcpui-choice");
    if (event.isTrusted !== true) {
      // Put the box back to what we last recorded, so a script-driven toggle from anywhere in this
      // document can never leave the visible box and the ids confirm would send disagreeing.
      event.currentTarget.checked = checkedIds[id] === true;
      return;
    }
    if (event.currentTarget.checked) checkedIds[id] = true;
    else delete checkedIds[id];
  }

  // Frozen with the buttons while a call is in flight and for good once one settles the dialog, so
  // the ticks on screen are always the ones that were sent.
  function setChoicesDisabled(disabled) {
    for (var k = 0; k < choiceInputs.length; k++) choiceInputs[k].disabled = disabled;
  }

  // DOM order, not \`for...in\` over checkedIds: object key order for arbitrary caller-supplied
  // strings is not something to depend on, even where every engine we run on happens to preserve it.
  function checkedChoiceIds() {
    var ids = [];
    for (var j = 0; j < choiceInputs.length; j++) {
      var choiceId = choiceInputs[j].getAttribute("data-mcpui-choice");
      // Both: a trusted tick recorded, and the box still showing it. Never send what isn't on screen.
      if (checkedIds[choiceId] === true && choiceInputs[j].checked) ids.push(choiceId);
    }
    return ids;
  }

  function onClick(event) {
    // Only a click the browser attributes to the user counts. element.click() and dispatchEvent
    // from any script in this document produce isTrusted === false.
    if (event.isTrusted !== true || locked) return;
    var action = event.currentTarget.getAttribute("data-mcpui-action");
    var step = PLAN[action];
    if (step === undefined) return;
    // Cancel is exempt: backing out early is never the harm this guards against.
    if (action === "confirm" && !dwellDone()) return;
    locked = true;
    setChoicesDisabled(true);
    if (step === null) {
      setBusy(true);
      setStatus(TEXT.dismissed, "dismissed");
      api.requestTeardown();
      return;
    }
    // Choices ride only on confirm, and only when this document has any -- with none, \`params\` stays
    // the exact \`step.params\` reference PLAN was built from, byte-identical to before this existed.
    var params = step.params;
    if (action === "confirm" && choiceInputs.length > 0) {
      var merged = {};
      var key;
      for (key in step.params) if (Object.prototype.hasOwnProperty.call(step.params, key)) merged[key] = step.params[key];
      merged[CHOICES_PARAM] = checkedChoiceIds();
      params = merged;
    }
    setBusy(true);
    setStatus(TEXT.working, "pending");
    api.callTool(step.toolName, params).then(function () {
      setStatus(TEXT.done, "done");
      api.requestTeardown();
    }, function (error) {
      // Re-enabled on failure (a rejected call did not happen, so the human must be able to retry
      // or cancel), unless the Host says this dialog is no longer pending -- see reportCallFailure.
      if (!reportCallFailure(error)) return;
      locked = false;
      setChoicesDisabled(false);
      // reportCallFailure re-enabled every button; confirm still waits out an unfinished dwell.
      syncConfirm();
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
    // Same title/actions the frame itself renders (via confirmationActions) — see that function's
    // doc for why this must never be a second, independently-maintained mapping. A host reads this
    // to build a parent-DOM mirror discoverable by page.find_elements; see MCP_UI_ACTION_PLAN_META_KEY.
    actionPlan: {
      title: spec.title,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      actions: confirmationActions(spec),
    },
  });
}
