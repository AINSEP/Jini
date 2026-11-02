/**
 * @file Server-side pieces every Google Workspace admin-surface handler shares: the plugin's one
 * connection id, a Google client over the surface capability port, the "is Sheets usable right now"
 * check, and the translation of plugin and host refusals into surface-safe failures.
 *
 * Exists because the three panels (connection, Picker, form destination) run in the host's
 * admin-surface handler seam, whose port differs from the tool port in one way that matters here:
 * connections are named by the surface's declared connection id, not by a connection ref. Keeping
 * that adaptation and the failure mapping in one place means every panel sends the same safe codes
 * and fixed messages (never Google's text, a token, or a file's contents) to the frame.
 */
import { readAccount } from './drive-files.mjs';
import { isProductEnabled } from './product-state.mjs';
import { GoogleWorkspaceError } from './request-policy.mjs';
import { SHEETS_PRODUCT_ID, sheetsClientFor } from './sheets-client.mjs';

/** The plugin's one sign-in: `tovu-connections.json`'s id, declared by every surface that uses it. */
export const CONNECTION_ID = 'account';

const FAILURE_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Panel-only refusals (nothing was sent to Google), with the fixed sentence the frame shows. */
const SURFACE_FAILURES = Object.freeze({
  'picker-expired': 'The file picker session ended. Close this panel, open it again, and choose the spreadsheet again.',
  'invalid-destination': 'The form name or tab is not valid. Use the form\'s short name (letters, digits, - or _) and choose a tab from the list.',
  'tab-not-found': 'That tab is not in the spreadsheet any more. Reload the tabs and choose one again.',
  'confirm-external-rows': 'Confirm that removing this destination later leaves the rows already written in the spreadsheet, then save again.',
  'too-many-destinations': 'This plugin keeps at most 50 form destinations. Remove one you no longer use, then save again.',
});

/**
 * A surface-safe failure for a panel-only refusal.
 * @param {{ fail: (input: { code: string, message: string }) => Error, code: keyof typeof SURFACE_FAILURES }} required
 * @returns {Error}
 * @complexity O(1).
 */
export function surfaceRefusal(required, _optional = {}) {
  return required.fail({ code: required.code, message: SURFACE_FAILURES[required.code] });
}

/**
 * The plugin's one Sheets client (product gate on every request) over the surface port: the client
 * asks for a `connectionRef`, and inside a surface handler that reference is the declared connection
 * id, which the host resolves for this plugin and workspace only.
 * @param {{ capabilities: { http: object, state: object, connections: { getAccessToken(input: { connectionId: string }): Promise<string> } } }} required
 * @returns {{ request(input: object, options?: object): Promise<unknown> }}
 * @complexity O(1).
 */
export function surfaceSheetsClient(required, _optional = {}) {
  const { http, state, connections } = required.capabilities;
  return sheetsClientFor({
    capabilities: { http, state, connections: { getAccessToken: ({ connectionRef }) => connections.getAccessToken({ connectionId: connectionRef }) } },
  });
}

/** The signed-in Google account (`{ accountId, displayName }`), read through the surface client. @complexity O(1): one request. */
export function surfaceAccount(required, _optional = {}) {
  return readAccount({ client: surfaceSheetsClient(required), connectionRef: CONNECTION_ID });
}

/** Status → why Sheets cannot be used yet, as a safe code. @complexity O(s) granted scope sets. */
function connectionRefusal(status) {
  if (status.status === 'reconnect-required') return 'reconnect-required';
  if (status.status !== 'connected') return 'not-connected';
  return status.grantedScopeSetIds.includes(SHEETS_PRODUCT_ID) ? null : 'missing-permission';
}

/**
 * Why the Picker (or anything else Sheets-backed on a panel) cannot run now, or null: the
 * connection must be connected with the Sheets permission granted, and Sheets must be turned on.
 * @param {{ capabilities: { connections: { status(input: { connectionId: string }): Promise<{ status: string, grantedScopeSetIds: readonly string[] }> }, state: { get(input: { key: string }): Promise<unknown> } } }} required
 * @returns {Promise<'not-connected' | 'reconnect-required' | 'missing-permission' | 'product-disabled' | null>}
 * @complexity O(1): one status read and one state read.
 */
export async function sheetsUnavailableReason(required, _optional = {}) {
  const { connections, state } = required.capabilities;
  const refusal = connectionRefusal(await connections.status({ connectionId: CONNECTION_ID }));
  if (refusal !== null) return refusal;
  return (await isProductEnabled({ state, productId: SHEETS_PRODUCT_ID })) ? null : 'product-disabled';
}

/**
 * Turns a refusal into what the frame may see: a plugin `GoogleWorkspaceError` keeps its code, fixed
 * message and retryable flag; a host refusal with a plain lowercase code keeps its code and message
 * (host messages are written for people and never carry secrets); anything else is rethrown so the
 * host's dispatcher answers with its generic failure and logs the cause.
 * @complexity O(1).
 */
function surfaceFailure(error, fail) {
  if (error instanceof GoogleWorkspaceError) return fail({ code: error.code, message: error.message }, { retryable: error.retryable });
  const hostRefusal = typeof error?.code === 'string' && FAILURE_CODE.test(error.code) && typeof error.message === 'string';
  return hostRefusal ? fail({ code: error.code, message: error.message }, { retryable: error.retryable === true }) : error;
}

/**
 * Runs one handler body with {@link surfaceFailure} applied to whatever it throws.
 * @param {{ fail: Function, run: () => Promise<unknown> }} required `fail` is the handler call's own.
 * @returns {Promise<unknown>} The body's result.
 * @complexity O(1) plus the body.
 */
export async function withSurfaceFailures(required, _optional = {}) {
  try {
    return await required.run();
  } catch (error) {
    throw surfaceFailure(error, required.fail);
  }
}
