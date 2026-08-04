/**
 * @module features/mcp-ui/surfaces/form
 *
 * Composes a field list into one complete input dialog: the same shell, details, status region and
 * action row `confirmation.ts` uses, wrapped in a real `<form>` whose submit collects, coerces, and
 * validates the fields before calling a tool.
 *
 * A real `<form>` rather than a div with a click handler, for two behaviors that would otherwise
 * need reimplementing: Enter in a text field submits it, and `form.elements` gives the script a
 * name-keyed control lookup without a DOM query per field.
 *
 * It carries `novalidate`, so the required-field check below is the only one that runs. Controls
 * still get their `required` attribute — that is what a screen reader announces — but the browser's
 * own validation UI is suppressed on purpose: its bubble is positioned against the viewport and gets
 * clipped by the frame's bounds in the small iframe a surface renders in, and the surface already
 * owns a live region that announces the same information without being clipped.
 *
 * ## Coercion is here, not at the tool
 *
 * Every value the DOM hands back is a string — `"3"`, `""`, `"true"`. A tool declaring a numeric
 * parameter would receive a string and either reject it or, worse, coerce it somewhere further
 * downstream where the failure is harder to attribute. So each field's declared kind drives the
 * conversion at the only point that knows it: `number` becomes a number or `null` when blank,
 * `boolean` reads `checked`, and `string`/`enum` pass through.
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
import { renderFieldControl, toFieldReadSpecs, type SurfaceField } from './fields.js';
import type { BridgeScriptSpec } from './bridge.js';
import type { SurfaceTokenName } from './tokens.js';

export interface FormSurfaceSpec {
  readonly title: string;
  readonly description?: string;
  /** Read-only context shown above the fields — what the input is *about*. */
  readonly details?: readonly SurfaceDetail[];
  readonly fields: readonly SurfaceField[];
  /** Callout above the buttons. */
  readonly warning?: string;
  /** Styles the submit button as destructive. */
  readonly danger?: boolean;
  readonly submitLabel: string;
  /** The tool the collected values are sent to. */
  readonly toolName: string;
  /**
   * Merged UNDER the collected field values, so a field can never be shadowed by a base param it
   * shares a name with. Where a confirmation token belongs when the form is a confirmation.
   */
  readonly baseParams?: Readonly<Record<string, unknown>>;
  /** Omit for a form with no cancel button. Give it a tool name to notify the server of the dismissal. */
  readonly cancel?: { readonly label: string; readonly toolName?: string; readonly params?: Readonly<Record<string, unknown>> };
  readonly text?: Partial<SurfaceStatusText>;
  readonly app?: BridgeScriptSpec;
  readonly lang?: string;
  readonly tokens?: Partial<Record<SurfaceTokenName, string>>;
}

const DEFAULT_APP: BridgeScriptSpec = { appName: 'jini-mcp-ui-form', appVersion: '1' };

/** The form element's id, fixed so the emitted script can find it without a fragile selector. */
const FORM_ELEMENT_ID = 'mcpui-form';

/**
 * Renders the form dialog as a complete, self-contained HTML document.
 *
 * @param spec - See {@link FormSurfaceSpec}.
 * @returns The full HTML string.
 * @complexity O(n) in the number of fields plus the rendered length.
 */
export function renderFormDocument(spec: FormSurfaceSpec): string {
  const text = { ...DEFAULT_SURFACE_STATUS_TEXT, ...spec.text };
  // Not `type: 'submit'` — see the runtime script below for why a submit-typed button inside this
  // particular `<form>` cannot work at all in production.
  const actions: SurfaceAction[] = [
    { id: 'submit', label: spec.submitLabel, variant: spec.danger === true ? 'danger' : 'primary' },
  ];
  if (spec.cancel !== undefined) actions.push({ id: 'cancel', label: spec.cancel.label, variant: 'neutral' });

  const controls = spec.fields.map(renderFieldControl).join('\n');
  const warning = spec.warning === undefined ? '' : `<p class="mcpui-warning">${escapeHtml(spec.warning)}</p>`;
  const bodyHtml = [
    renderSurfaceHeader(
      spec.description === undefined ? { title: spec.title } : { title: spec.title, description: spec.description },
    ),
    renderDetailList(spec.details ?? []),
    `<form id="${FORM_ELEMENT_ID}" novalidate>\n<fieldset class="mcpui-fields">\n${controls}\n</fieldset>\n${warning}\n${renderActions(actions)}\n</form>`,
    renderStatusRegion(),
  ]
    .filter((fragment) => fragment !== '')
    .join('\n');

  const cancelPlan =
    spec.cancel?.toolName === undefined
      ? null
      : { toolName: spec.cancel.toolName, params: spec.cancel.params ?? {} };

  const script = `(function () {
  "use strict";
${SURFACE_SCRIPT_PRELUDE}
  var FIELDS = ${escapeJsValue(toFieldReadSpecs(spec.fields))};
  var TOOL = ${escapeJsValue(spec.toolName)};
  var BASE_PARAMS = ${escapeJsValue(spec.baseParams ?? {})};
  var CANCEL = ${escapeJsValue(cancelPlan)};
  var TEXT = ${escapeJsValue(text)};
  var form = document.getElementById(${escapeJsValue(FORM_ELEMENT_ID)});

  // form.elements[name] yields a RadioNodeList when several controls share a name and the BARE
  // element when only one does. A one-option checklist would otherwise read as "no options" —
  // silently, since a bare input has no length to iterate. Presence of "checked" is what tells the
  // two apart: an input has it, a RadioNodeList does not.
  function checkedValues(control) {
    if (!control) return [];
    var nodes = typeof control.length === "number" && !("checked" in control) ? control : [control];
    var out = [];
    for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].checked) out.push(nodes[i].value);
    return out;
  }

  function readField(field) {
    var control = form.elements[field.name];
    if (field.kind === "boolean") return control.checked;
    if (field.kind === "number") return control.value === "" ? null : Number(control.value);
    if (field.kind === "multi-enum") return checkedValues(control);
    // Covers a radio-presented enum too: a RadioNodeList's own .value is the checked radio's
    // value, or "" when none is checked — the same shape a <select> reports.
    return control.value;
  }

  function isBlank(field, value) {
    if (field.kind === "boolean") return value !== true;
    if (field.kind === "number") return value === null || isNaN(value);
    // Required means "choose at least one", never "choose this one" — see choice-group.ts on why
    // the native required attribute is deliberately not used for a checkbox group.
    if (field.kind === "multi-enum") return value.length === 0;
    return value === "";
  }

  // NOT wired to the form's "submit" event. Per the WHATWG form submission algorithm, the
  // sandboxed-forms browsing-context check runs BEFORE that event is ever dispatched, so in the
  // real target sandbox (MCP_UI_VIEW_SANDBOX grants "allow-scripts" and nothing else -- no
  // "allow-forms") clicking a type=submit button never fires "submit" at all: the browser blocks
  // the attempt at the point of activation and no listener sees it, cancelable or not. A
  // preventDefault() in a "submit" handler is consequently dead code here, unreachable no matter
  // how it is written. The submit button is type=button (see the actions array above) for exactly
  // this reason, and this function is called directly from its "click" handler below -- "click" is
  // unaffected by the sandboxed-forms flag, which only ever gates form submission.
  function runSubmit() {
    var params = {};
    var key;
    for (key in BASE_PARAMS) if (Object.prototype.hasOwnProperty.call(BASE_PARAMS, key)) params[key] = BASE_PARAMS[key];
    var missing = [];
    for (var i = 0; i < FIELDS.length; i++) {
      var value = readField(FIELDS[i]);
      if (FIELDS[i].required && isBlank(FIELDS[i], value)) missing.push(FIELDS[i].label);
      params[FIELDS[i].name] = value;
    }
    if (missing.length > 0) {
      setStatus(TEXT.missingPrefix + missing.join(", "), "invalid");
      return;
    }
    setBusy(true);
    setStatus(TEXT.working, "pending");
    api.callTool(TOOL, params).then(function () {
      setStatus(TEXT.done, "done");
      api.requestTeardown();
    }, function (error) {
      setBusy(false);
      setStatus(TEXT.failedPrefix + describeError(error), "failed");
    });
  }

  // Enter-to-submit, restored deliberately rather than left to the (equally dead, same root cause)
  // native behavior a single-line text input gets inside a real form. Scoped to the same controls
  // the browser would have honored it for -- type=text/type=number inputs -- so Enter still inserts
  // a newline in a multi-line textarea and still just toggles a checkbox.
  form.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    var target = event.target;
    if (!target || target.tagName !== "INPUT") return;
    var type = (target.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") return;
    event.preventDefault();
    runSubmit();
  });

  for (var b = 0; b < actionButtons.length; b++) {
    var action = actionButtons[b].getAttribute("data-mcpui-action");
    if (action === "submit") {
      actionButtons[b].addEventListener("click", runSubmit);
      continue;
    }
    if (action !== "cancel") continue;
    actionButtons[b].addEventListener("click", function () {
      setBusy(true);
      if (CANCEL === null) {
        setStatus(TEXT.dismissed, "dismissed");
        api.requestTeardown();
        return;
      }
      setStatus(TEXT.working, "pending");
      api.callTool(CANCEL.toolName, CANCEL.params).then(function () {
        setStatus(TEXT.dismissed, "dismissed");
        api.requestTeardown();
      }, function (error) {
        setBusy(false);
        setStatus(TEXT.failedPrefix + describeError(error), "failed");
      });
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
 * Renders the form dialog as an MCP-UI resource, ready for a tool result's `content` array.
 *
 * @param spec.uri - The `ui://` identifier. Never key it by a confirmation token.
 * @complexity O(n) in the number of fields plus the rendered length.
 */
export function buildFormSurface(
  spec: FormSurfaceSpec & { uri: UIResourceUri; preferredFrameSize?: readonly [string, string] },
): UIResource {
  return createUIResource({
    uri: spec.uri,
    htmlString: renderFormDocument(spec),
    ...(spec.preferredFrameSize === undefined ? {} : { preferredFrameSize: spec.preferredFrameSize }),
  });
}
