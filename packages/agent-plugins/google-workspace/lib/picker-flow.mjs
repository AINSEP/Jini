/**
 * @file The server half of "Choose spreadsheet", shared by the Picker panel and the form-destination
 * panel: the hosted Picker's bootstrap and its selection check, and the desktop native Picker's start
 * and finish. Every path ends in `verifySelectedSpreadsheet` (`picker-selection.mjs`) before a
 * selection is returned, so nothing a browser or a callback claims is saved unchecked.
 *
 * Hosted: the bootstrap opens a Picker session in the plugin's own settings (random id, the account
 * the token belongs to, 15-minute expiry) and gives the surface ONLY a short-lived access token plus
 * the public Picker config. A selection is accepted only for a live session of this surface, and
 * only for that same account.
 *
 * Desktop: Google's native Picker runs in the system browser as a code + PKCE sign-in with
 * `trigger_onepick` and the spreadsheet MIME filter. The pending attempt (the host's opaque attempt
 * id plus the expected account) is kept in the plugin's settings, the frame polls `finish`, and the
 * `picked_file_ids` callback field is read only through the host's consume-once inbox, which fills
 * only after the sign-in's state and code checked out. A cancel returns no selection and changes
 * nothing.
 *
 * Which path runs: the host says (`context.hostKind`), never the config. Desktop always uses the
 * native Picker in the system browser; hosted uses the JS Picker, which needs a browser key and app
 * id, so a hosted site without both is `unavailable` (`picker-not-configured`) rather than falling
 * back to a flow built for the desktop app.
 */
import { DESKTOP_PICKER_START_PARAMS, parsePickedFileIds, verifySelectedSpreadsheet } from './picker-selection.mjs';
import { GoogleWorkspaceError } from './request-policy.mjs';
import { SHEETS_PRODUCT_ID } from './sheets-client.mjs';
import { CONNECTION_ID, sheetsUnavailableReason, surfaceAccount, surfaceRefusal, surfaceSheetsClient } from './surface-actions.mjs';

// The names keep their `TOVU_` prefix: sites already set them, and renaming would unconfigure them.
/** Public config the hosted JS Picker needs; placeholders the operator sets, never secrets. */
export const PICKER_CONFIG_NAMES = Object.freeze({ developerKey: 'TOVU_GOOGLE_PICKER_BROWSER_KEY', appId: 'TOVU_GOOGLE_PICKER_APP_ID' });

/** Long enough to browse Drive in the Picker; short enough that a forgotten tab stops being usable. */
export const PICKER_SESSION_TTL_MS = 15 * 60_000;

const sessionKey = (surfaceId) => `picker-session:${surfaceId}`;
const attemptKey = (surfaceId) => `picker-attempt:${surfaceId}`;

/** What the frame and chat may see of a verified spreadsheet: metadata only. */
export const metadataOf = ({ spreadsheetId, title, url }) => ({ spreadsheetId, title, url });

/** Both hosted Picker values, or null when either is unset. @complexity O(1): two config reads. */
async function hostedPickerConfig(publicConfig) {
  const developerKey = await publicConfig.get({ name: PICKER_CONFIG_NAMES.developerKey });
  const appId = await publicConfig.get({ name: PICKER_CONFIG_NAMES.appId });
  return developerKey && appId ? { developerKey, appId } : null;
}

/** The bootstrap for a Picker that cannot run here: the safe code and its fixed sentence. @complexity O(1). */
const unavailable = (reason) => ({ mode: 'unavailable', reason, message: new GoogleWorkspaceError({ code: reason }).message });

/** A stored session that is this surface's, unexpired, and the one the frame names. @complexity O(1). */
function isLiveSession(session, sessionId, nowMs) {
  if (typeof session?.id !== 'string' || session.id !== sessionId) return false;
  return typeof session.accountId === 'string' && typeof session.expiresAt === 'number' && session.expiresAt > nowMs;
}

/** A stored desktop attempt in the shape `start` wrote. @complexity O(1). */
function isPendingAttempt(pending) {
  return typeof pending?.attemptId === 'string' && typeof pending.accountId === 'string' && typeof pending.expiresAt === 'number';
}

/**
 * Builds the Picker flow.
 * @param {object} [_required]
 * @param {{ now?: () => number, randomId?: () => string }} [optional] Clock and session-id source (tests).
 * @returns {{ bootstrap: Function, verifyHosted: Function, startSystemBrowser: Function, finishSystemBrowser: Function }}
 *   Each takes the handler call (`{ capabilities, context, input?, fail? }`); the verified results
 *   are `{ spreadsheetId, title, url, accountId }` (the caller strips `accountId` before replying).
 * @complexity O(1) to build; each step is a bounded number of host and Google calls.
 */
export function createPickerFlow(_required = {}, optional = {}) {
  const now = optional.now ?? Date.now;
  const randomId = optional.randomId ?? (() => globalThis.crypto.randomUUID());

  /** Opens a hosted session: the account, the token, the public config. @complexity O(1): three requests. */
  async function openHostedSession(capabilities, context, config) {
    const account = await surfaceAccount({ capabilities });
    const accessToken = await capabilities.connections.getAccessToken({ connectionId: CONNECTION_ID });
    const session = { id: randomId(), accountId: account.accountId, expiresAt: now() + PICKER_SESSION_TTL_MS };
    await capabilities.state.set({ key: sessionKey(context.surfaceId), value: session });
    return { mode: 'hosted', accountLabel: account.displayName, picker: { accessToken, ...config, sessionId: session.id } };
  }

  return {
    /**
     * The surface's start data: `unavailable` (with the safe code and its fixed sentence), `system-browser`,
     * or `hosted` with the Picker session. The one answer that carries an access token.
     */
    async bootstrap({ capabilities, context }) {
      const reason = await sheetsUnavailableReason({ capabilities });
      if (reason !== null) return unavailable(reason);
      if (context.hostKind === 'desktop') return { mode: 'system-browser' };
      const config = await hostedPickerConfig(capabilities.publicConfig);
      return config === null ? unavailable('picker-not-configured') : openHostedSession(capabilities, context, config);
    },

    /** Hosted: the frame's `{ sessionId, fileId }` → the verified spreadsheet, for the session's account only. */
    async verifyHosted({ capabilities, context, input, fail }) {
      const session = await capabilities.state.get({ key: sessionKey(context.surfaceId) });
      if (!isLiveSession(session, input.sessionId, now())) throw surfaceRefusal({ fail, code: 'picker-expired' });
      return verifySelectedSpreadsheet({ client: surfaceSheetsClient({ capabilities }), connectionRef: CONNECTION_ID, fileId: input.fileId, expectedAccountId: session.accountId });
    },

    /** Desktop: starts the native Picker sign-in; the host page opens it in the system browser. */
    async startSystemBrowser({ capabilities, context }) {
      // The account read goes through the Sheets client, so Sheets being off refuses here, before any sign-in.
      const account = await surfaceAccount({ capabilities });
      // Native Picker allows drive.file only, so this re-consent asks for the Sheets scope set alone.
      const started = await capabilities.connections.begin(
        { connectionId: CONNECTION_ID, action: 'reconnect' },
        { scopeSetIds: [SHEETS_PRODUCT_ID], startParams: { ...DESKTOP_PICKER_START_PARAMS } },
      );
      const pending = { attemptId: started.attemptId, accountId: account.accountId, expiresAt: Date.parse(started.expiresAt) };
      await capabilities.state.set({ key: attemptKey(context.surfaceId), value: pending });
      return { expiresAt: started.expiresAt };
    },

    /**
     * Desktop: polls the pending attempt. `{ status: 'none' | 'waiting' | 'expired' | 'cancelled' }`,
     * or `{ status: 'selected', spreadsheet }` once the callback's file id checked out.
     */
    async finishSystemBrowser({ capabilities, context }) {
      const key = attemptKey(context.surfaceId);
      const pending = await capabilities.state.get({ key });
      if (!isPendingAttempt(pending)) return { status: 'none' };
      if (pending.expiresAt <= now()) { await capabilities.state.delete({ key }); return { status: 'expired' }; }
      const fields = await capabilities.connections.takeCallbackFields({ connectionId: CONNECTION_ID, attemptId: pending.attemptId });
      if (fields === null) return { status: 'waiting' };
      await capabilities.state.delete({ key });
      const fileId = parsePickedFileIds({ value: fields.picked_file_ids });
      if (fileId === null) return { status: 'cancelled' };
      const spreadsheet = await verifySelectedSpreadsheet({ client: surfaceSheetsClient({ capabilities }), connectionRef: CONNECTION_ID, fileId, expectedAccountId: pending.accountId });
      return { status: 'selected', spreadsheet };
    },
  };
}

/** The reply shape of a desktop poll: the spreadsheet's metadata only. @complexity O(1). */
export function pollReply(required, _optional = {}) {
  const { outcome } = required;
  return outcome.status === 'selected' ? { status: 'selected', spreadsheet: metadataOf(outcome.spreadsheet) } : { status: outcome.status };
}

/** The plugin-settings key holding the spreadsheets picked on the Picker panel, newest first. */
export const PICKED_SPREADSHEETS_KEY = 'picked-spreadsheets';
const MAX_PICKED = 10;

/**
 * The picked spreadsheets kept in the plugin's settings (metadata and the account they were picked
 * with), newest first; entries in any other shape are dropped.
 * @param {{ state: { get(input: { key: string }): Promise<unknown> } }} required
 * @returns {Promise<Array<{ spreadsheetId: string, title: string, url: string, accountId: string }>>}
 * @complexity O(n), n ≤ 10.
 */
export async function readPickedSpreadsheets(required, _optional = {}) {
  const stored = await required.state.get({ key: PICKED_SPREADSHEETS_KEY });
  return Array.isArray(stored) ? stored.filter((entry) => typeof entry?.spreadsheetId === 'string' && typeof entry.accountId === 'string') : [];
}

/**
 * Saves a VERIFIED selection at the top of the picked list (one entry per spreadsheet, at most 10).
 * @param {{ state: { get: Function, set: Function }, spreadsheet: { spreadsheetId: string, title: string, url: string, accountId: string } }} required
 * @complexity O(n), n ≤ 10.
 */
export async function rememberPickedSpreadsheet(required, _optional = {}) {
  const { state, spreadsheet } = required;
  const others = (await readPickedSpreadsheets({ state })).filter((entry) => entry.spreadsheetId !== spreadsheet.spreadsheetId);
  const entry = { ...metadataOf(spreadsheet), accountId: spreadsheet.accountId };
  await state.set({ key: PICKED_SPREADSHEETS_KEY, value: [entry, ...others].slice(0, MAX_PICKED) });
}
