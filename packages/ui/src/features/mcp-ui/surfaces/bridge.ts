/**
 * @module features/mcp-ui/surfaces/bridge
 *
 * The inline `<script>` every generated surface carries: the View half of the MCP Apps handshake,
 * emitted as a JavaScript source string because it runs inside a sandboxed iframe with no bundler,
 * no module loader, and no shared runtime to import from.
 *
 * ## Why the surface HTML cannot just post an action and be done
 *
 * `mcp-ui-apps.ts` states the ordering rule the spec makes normative: a Host MUST NOT send anything
 * to a View before `ui/notifications/initialized`, and — the mirror of it, which is what this script
 * has to respect — a Host answers a View's requests only once the handshake is complete. Our own
 * Host refuses a `tools/call` that arrives in `awaiting-initialize` with a JSON-RPC
 * `invalidRequest`. So a surface that posted its action on click without ever handshaking would get
 * a refusal, not an execution. {@link renderBridgeScript} therefore runs `ui/initialize` at load
 * time and queues any `callTool` made before the response lands.
 *
 * ## Which action shape this emits, and what it deliberately does not
 *
 * The community `@mcp-ui/client` SDK accepts a legacy, non-JSON-RPC action —
 * `{ type: 'tool', payload: { toolName, params } }` — and Tovu's
 * `src/features/post/delete-confirmation-ui.ts` emits exactly that. This bridge emits the JSON-RPC
 * `tools/call` request from {@link MCP_UI_VIEW_METHODS} instead, and emits **only** that.
 *
 * That is a real divergence from the brief this module was built to, and it is deliberate: the two
 * shapes are alternatives, not layers. Emitting both would mean a host that understands both
 * executes the tool twice — the worst possible outcome for a surface whose entire purpose is
 * confirming a destructive action. JSON-RPC wins because it is what the Host in `react/mcp-ui/`
 * speaks, what the standardized spec fixed, and the only one of the two with a response correlated
 * back to the caller, which is what lets a dialog report "done" or "failed" instead of appearing to
 * do nothing. A consumer needing the legacy shape for an existing mcp-ui host should build that
 * surface with its own script rather than have this one emit both.
 *
 * ## What the script must never do
 *
 * No `localStorage` / `sessionStorage` (both throw `SecurityError` in the opaque origin this
 * package's sandbox produces — see `MCP_UI_VIEW_SANDBOX`), no `scrollIntoView` (it breaks iframe
 * preview layout), no cross-document `<a href>` (dead in an isolated frame; use `ui/open-link`
 * through {@link SURFACE_BRIDGE_GLOBAL} instead).
 */
import { escapeJsValue } from '../escape.js';
import { MCP_UI_PROTOCOL_VERSION } from '../protocol.js';

/**
 * The global a surface's own script reaches the protocol through.
 *
 * A global rather than a module export because the surface script is a second classic `<script>` in
 * the same document — there are no modules to import between them.
 */
export const SURFACE_BRIDGE_GLOBAL = 'jiniMcpUi';

/**
 * Set on `<html>` when the handshake fails, so a host, a test, or a human with devtools open can
 * tell "the Host never answered `ui/initialize`" apart from "the surface's own script threw".
 */
export const SURFACE_HANDSHAKE_FAILED_ATTRIBUTE = 'data-mcpui-handshake-failed';

export interface BridgeScriptSpec {
  /** Reported to the Host as `appInfo.name` in `ui/initialize`. */
  readonly appName: string;
  /** Reported to the Host as `appInfo.version`. */
  readonly appVersion: string;
  /** Defaults to {@link MCP_UI_PROTOCOL_VERSION}. */
  readonly protocolVersion?: string;
}

/**
 * Renders the View-side protocol bridge as JavaScript source.
 *
 * The emitted script defines `window[SURFACE_BRIDGE_GLOBAL]` with:
 * - `callTool(name, args)` → `Promise` of the tool result, queued until the handshake completes and
 *   rejected with the Host's own error message on a JSON-RPC error response.
 * - `notify(method, params)` → a raw fire-and-forget notification, for the lifecycle messages a
 *   surface may want beyond what the bridge sends itself.
 * - `openLink(url)` → `ui/open-link`, the only way an isolated frame can navigate anything.
 * - `requestTeardown()` → `ui/notifications/request-teardown`, the draft-spec way for a "Done"
 *   button to ask the Host to remove the frame.
 * - `whenReady(fn)` → runs `fn` after the handshake, immediately if it already completed.
 *
 * The script also answers the Host's `ui/resource-teardown` request. That answer is not optional
 * politeness: our Host waits (bounded) for it before removing the frame, so a View that never
 * responded would stall every teardown to its timeout.
 *
 * @param spec - See {@link BridgeScriptSpec}.
 * @returns JavaScript source, to be placed in a classic `<script>` before the surface's own script.
 * @complexity O(1) — a constant template with three interpolations.
 */
export function renderBridgeScript(spec: BridgeScriptSpec): string {
  const appInfo = escapeJsValue({ name: spec.appName, version: spec.appVersion });
  const protocolVersion = escapeJsValue(spec.protocolVersion ?? MCP_UI_PROTOCOL_VERSION);
  const global = SURFACE_BRIDGE_GLOBAL;
  const failedAttribute = escapeJsValue(SURFACE_HANDSHAKE_FAILED_ATTRIBUTE);

  return `(function () {
  "use strict";
  var HOST = window.parent;
  var APP_INFO = ${appInfo};
  var PROTOCOL_VERSION = ${protocolVersion};
  var nextId = 1;
  var pending = Object.create(null);
  var ready = false;
  var settled = false;
  var queuedCalls = [];
  var readyHandlers = [];
  var hostContext = null;

  // Posted to "*", not to a specific origin, because a sandboxed frame without allow-same-origin
  // has an opaque origin and no way to learn its embedder's. The Host does not trust origin either
  // — it authenticates by event.source identity against its own iframe's contentWindow, which a
  // third party cannot forge.
  function post(message) { HOST.postMessage(message, "*"); }

  function notify(method, params) {
    post(params === undefined
      ? { jsonrpc: "2.0", method: method }
      : { jsonrpc: "2.0", method: method, params: params });
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "view-" + nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }

  // A call made before the handshake completes is held, not sent: our Host answers a pre-handshake
  // tools/call with a JSON-RPC invalidRequest, so sending early would turn "the user clicked a
  // little too fast" into a refusal the surface would have to explain. A call held when the
  // handshake FAILS is rejected rather than held forever, so the dialog can say so.
  function callTool(name, args) {
    var params = { name: name, arguments: args || {} };
    if (ready) return request("tools/call", params);
    return new Promise(function (resolve, reject) {
      queuedCalls.push({ resolve: resolve, reject: reject, params: params });
    });
  }

  function reportSize() {
    var root = document.documentElement;
    notify("ui/notifications/size-changed", { width: root.scrollWidth, height: root.scrollHeight });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
    if (typeof data.method === "string") {
      if (!("id" in data)) return;
      if (data.method === "ui/resource-teardown") {
        post({ jsonrpc: "2.0", id: data.id, result: {} });
        return;
      }
      post({ jsonrpc: "2.0", id: data.id, error: { code: -32601, message: "View does not implement " + data.method } });
      return;
    }
    var waiter = pending[data.id];
    if (!waiter) return;
    delete pending[data.id];
    if (data.error) waiter.reject(toError(data.error));
    else waiter.resolve(data.result);
  });

  function toError(error) {
    var failure = new Error(error && typeof error.message === "string" ? error.message : "Host returned an error");
    if (error && typeof error.code === "number") failure.code = error.code;
    return failure;
  }

  function onHandshakeDone(result) {
    hostContext = result && result.hostContext ? result.hostContext : null;
    ready = true;
    settled = true;
    notify("ui/notifications/initialized");
    reportSize();
    var calls = queuedCalls;
    var handlers = readyHandlers;
    queuedCalls = [];
    readyHandlers = [];
    for (var i = 0; i < calls.length; i++) request("tools/call", calls[i].params).then(calls[i].resolve, calls[i].reject);
    for (var j = 0; j < handlers.length; j++) handlers[j]();
    if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.documentElement);
  }

  function onHandshakeFailed(error) {
    settled = true;
    document.documentElement.setAttribute(${failedAttribute}, "true");
    var calls = queuedCalls;
    queuedCalls = [];
    // Rejected, never dropped: a queued call is a click the human already made, and a promise that
    // never settles is a dialog stuck on "Working…" with nothing to say.
    for (var i = 0; i < calls.length; i++) calls[i].reject(error instanceof Error ? error : new Error("MCP-UI handshake failed"));
    // readyHandlers are intentionally not run — "when ready" never became true.
    readyHandlers = [];
  }

  request("ui/initialize", {
    protocolVersion: PROTOCOL_VERSION,
    appInfo: APP_INFO,
    appCapabilities: {}
  }).then(onHandshakeDone, onHandshakeFailed);

  window.${global} = {
    callTool: callTool,
    notify: notify,
    openLink: function (url) { notify("ui/open-link", { url: url }); },
    requestTeardown: function () { notify("ui/notifications/request-teardown"); },
    whenReady: function (fn) { if (ready) fn(); else if (!settled) readyHandlers.push(fn); },
    hostContext: function () { return hostContext; },
    isReady: function () { return ready; }
  };
}());`;
}
