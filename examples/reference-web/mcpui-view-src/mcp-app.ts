/**
 * @file The View half of the MCP Apps demo, using the REAL, officially-maintained
 * `@modelcontextprotocol/ext-apps` SDK (`App` class) for the compliant happy path, rather than a
 * hand-rolled reimplementation of the wire protocol.
 *
 * This exists because the earlier version of this fixture hand-rolled the View's JSON-RPC
 * envelope by hand — reasonable for the Host (Jini's own `mcp-ui-apps.ts` primitives ARE the
 * thing under test, so the Host must use them), but wrong for the View: nothing about testing
 * Jini's Host implementation requires reinventing the View's protocol logic too, and a maintained
 * SDK is a more trustworthy, more spec-authoritative counterparty to test Jini's Host against
 * than an ad hoc reimplementation that could carry its own bugs unrelated to Jini's code.
 *
 * Built via `vite-plugin-singlefile` into one self-contained HTML document — the daemon serves
 * the build OUTPUT (`daemon.ts`'s `/mcpui-lab/view` route), not this source directly.
 *
 * The adversarial surface (malformed JSON-RPC, calling a tool before `ui/initialize`, never
 * sending `ui/notifications/initialized`, never responding to a teardown request) is
 * DELIBERATELY NOT expressed through the SDK — a spec-compliant SDK has no API for constructing a
 * spec violation, by design. Those cases bypass the SDK entirely via raw `postMessage`, which is
 * not "reinventing the SDK": it is the fuzzing half no SDK provides.
 */
import { App, type McpUiHostContext, type McpUiResourceTeardownResult } from '@modelcontextprotocol/ext-apps';
// Shared with the Host (`McpUiLab.tsx`/`McpUiLabHost.tsx`) so the two sides cannot drift apart on
// what mode names exist — see that module's doc for the full mode contract.
import { isMcpUiLabViewMode, type McpUiLabViewMode } from '../src/mcpui-lab-view.js';

type ViewMode = McpUiLabViewMode;

const qs = new URLSearchParams(location.search);
const requestedMode = qs.get('mode') ?? 'normal';
const mode: ViewMode = isMcpUiLabViewMode(requestedMode) ? requestedMode : 'normal';

const statusEl = document.getElementById('status')!;
const logEl = document.getElementById('log')!;

function appendLog(direction: 'out' | 'in' | 'error' | 'info', text: string): void {
  const li = document.createElement('li');
  li.dataset.dir = direction;
  li.textContent = `[${direction}] ${text}`;
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Sends a raw, hand-built message straight at the parent window — deliberately bypassing the
 * SDK's transport. `'*'` target origin matches what the SDK's own `PostMessageTransport` does
 * (verified against its published source: it always sends with `"*"` and documents that "the
 * receiver should validate the message source for security") — the security boundary this
 * fixture is testing lives entirely on the Host's RECEIVING side, not in what a sender claims.
 */
function postRaw(message: unknown): void {
  window.parent.postMessage(message, '*');
}

// ---- Widget UI (SDK-independent — a local counter, no server tool needed) ----
let count = 0;
const countEl = document.getElementById('count') as HTMLOutputElement;
const filler = document.getElementById('resize-filler') as HTMLDivElement;
let tall = false;

document.getElementById('inc')!.addEventListener('click', () => {
  count += 1;
  countEl.textContent = String(count);
});
document.getElementById('dec')!.addEventListener('click', () => {
  count -= 1;
  countEl.textContent = String(count);
});
document.getElementById('grow')!.addEventListener('click', () => {
  tall = !tall;
  filler.style.height = tall ? '160px' : '0px';
  // No manual size-changed notification here on purpose: this exercises the SDK's own
  // `autoResize` (default true, ResizeObserver-backed per its published d.ts) rather than
  // hand-rolling what the SDK already does correctly.
});

// ---- Adversarial raw-postMessage probes (intentionally NOT using the SDK) ----
document.getElementById('btn-malformed-no-jsonrpc')!.addEventListener('click', () => {
  postRaw({ method: 'ui/notifications/size-changed', params: { width: 1, height: 1 } });
  appendLog('out', 'RAW malformed post: missing jsonrpc field');
});
document.getElementById('btn-malformed-bad-id')!.addEventListener('click', () => {
  postRaw({ jsonrpc: '2.0', id: { nested: true }, method: 'tools/call', params: {} });
  appendLog('out', 'RAW malformed post: object-typed id');
});
document.getElementById('btn-unknown-method')!.addEventListener('click', () => {
  postRaw({ jsonrpc: '2.0', id: 'unknown-method-probe', method: 'x-not-a-real/method', params: {} });
  appendLog('out', 'RAW well-formed request, unknown method');
});
document.getElementById('btn-spam-resize')!.addEventListener('click', () => {
  for (let i = 0; i < 50; i += 1) {
    postRaw({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300 + i, height: 200 + i } });
  }
  appendLog('out', 'spammed 50x size-changed synchronously (RAW, bypassing the SDK)');
});

function attemptSandboxEscape(app: App): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    const title = (window.parent as unknown as { document: { title: string } }).document.title;
    appendLog('error', `SECURITY BUG: reached window.parent.document.title = ${title}`);
    void app.sendLog({ level: 'error', data: 'SECURITY BUG: read parent document.title' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    appendLog('in', `sandbox holds: window.parent.document threw: ${reason}`);
    void app.sendLog({ level: 'info', data: `sandbox holds: ${reason}` });
  }
}

function handleHostContextChanged(_ctx: McpUiHostContext): void {
  appendLog('in', 'ui/notifications/host-context-changed');
}

/**
 * `mode=no-initialized`: the SDK's `connect()` always completes the FULL handshake including
 * `ui/notifications/initialized` — there is no documented hook to withhold it. Simulating a
 * View that hangs mid-handshake genuinely requires bypassing the SDK for this one case; the
 * request itself is a real, correctly-shaped `ui/initialize`, hand-built to match what the SDK
 * would send, with the one deliberate omission being the point of the test.
 */
function runNoInitializedProbe(): void {
  const id = 'view-noinit-1';
  window.addEventListener('message', function onMessage(event: MessageEvent) {
    const data = event.data as { jsonrpc?: string; id?: unknown; result?: unknown; error?: unknown } | null;
    if (!data || data.jsonrpc !== '2.0' || data.id !== id || (!('result' in data) && !('error' in data))) return;
    window.removeEventListener('message', onMessage);
    statusEl.textContent = `initialize acknowledged, deliberately withholding initialized (mode=${mode})`;
    appendLog('error', 'NOT sending ui/notifications/initialized on purpose');
  });
  postRaw({ jsonrpc: '2.0', id, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appCapabilities: {} } });
  appendLog('out', `RAW ui/initialize sent (id=${id}), mode=${mode}`);
}

async function start(): Promise<void> {
  if (mode === 'call-before-init') {
    postRaw({ jsonrpc: '2.0', id: 'premature-tools-call', method: 'tools/call', params: { name: 'anything', arguments: {} } });
    appendLog('out', 'RAW tools/call sent BEFORE ui/initialize (adversarial, mode=call-before-init)');
  }

  if (mode === 'no-initialized') {
    runNoInitializedProbe();
    return;
  }

  const app = new App({ name: 'MCP Apps Lab Widget', version: '1.0.0' });

  app.onteardown = async (): Promise<McpUiResourceTeardownResult> => {
    appendLog('in', 'ui/resource-teardown request received (SDK onteardown)');
    if (mode === 'never-respond-teardown') {
      appendLog('error', 'deliberately never resolving onteardown (mode=never-respond-teardown)');
      // A Promise that never settles: the SDK awaits this before sending any response, so this
      // is a spec-compliant, SDK-native way to simulate a View that never acknowledges teardown.
      return new Promise<McpUiResourceTeardownResult>(() => undefined);
    }
    appendLog('out', 'responding to teardown with {} (SDK sends this automatically)');
    return {};
  };
  app.ontoolinput = (params) => appendLog('in', `ui/notifications/tool-input: ${JSON.stringify(params)}`);
  app.ontoolresult = (result) => appendLog('in', `ui/notifications/tool-result: ${JSON.stringify(result)}`);
  app.ontoolcancelled = (params) => appendLog('in', `ui/notifications/tool-cancelled: ${params.reason}`);
  app.onerror = (error) => appendLog('error', `SDK error: ${String(error)}`);
  app.onhostcontextchanged = handleHostContextChanged;

  document.getElementById('btn-request-teardown')!.addEventListener('click', () => {
    appendLog('out', 'ui/notifications/request-teardown (app.requestTeardown())');
    void app.requestTeardown();
  });

  try {
    await app.connect();
    statusEl.textContent = `ready (mode=${mode})`;
    appendLog('info', 'app.connect() resolved — ui/initialize + ui/notifications/initialized both completed via the SDK');
    const ctx = app.getHostContext();
    if (ctx) handleHostContextChanged(ctx);
    attemptSandboxEscape(app);
  } catch (error) {
    statusEl.textContent = 'connect failed';
    appendLog('error', `app.connect() failed: ${String(error)}`);
  }
}

void start();
