/**
 * @file "Choose spreadsheet" in the browser, shared by the Picker panel and the form-destination
 * panel. Resolves with the server-VERIFIED spreadsheet metadata, or null when the person cancelled
 * (nothing is saved on cancel).
 *
 * Hosted: loads Google's JS Picker (the one script origin the surface's CSP allows) and opens it with
 * the bootstrap's short-lived access token and public config, spreadsheets only, one file. The file
 * id it returns is only a claim: it goes to `verify-picked` with the Picker session id, and only the
 * server's answer is used.
 *
 * Desktop: the native Picker runs in the system browser. `start-system-picker` makes the server start
 * that sign-in (the admin page offers the link; this frame cannot open one), then the frame polls
 * `finish-system-picker` until the server reports a verified selection, a cancel, or the expiry.
 */
import { wait } from './dom.mjs';
import { pollText } from './picker-view.mjs';

const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';
const POLL_MS = 3000;

/**
 * Loads Google's Picker library once. Rejects when the script is blocked or fails, and forgets the
 * failure so the next "Choose spreadsheet" (the message says "try again") loads it again.
 */
let pickerLibrary;
function loadPickerLibrary() {
  pickerLibrary ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PICKER_SCRIPT;
    script.onerror = () => { pickerLibrary = undefined; reject(new Error('Google\'s file picker could not load (a blocked script, network, or browser setting). Allow apis.google.com and try again.')); };
    script.onload = () => window.gapi.load('picker', { callback: () => resolve(window.google.picker), onerror: script.onerror });
    document.head.append(script);
  });
  return pickerLibrary;
}

/** Opens the hosted Picker; resolves with the picked file id, or null on cancel. */
async function pickHostedFileId(config) {
  const picker = await loadPickerLibrary();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setMimeTypes(SPREADSHEET_MIME_TYPE);
    const onEvent = (data) => {
      const action = data[picker.Response.ACTION];
      if (action === picker.Action.PICKED) resolve(data[picker.Response.DOCUMENTS]?.[0]?.[picker.Document.ID] ?? null);
      else if (action === picker.Action.CANCEL) resolve(null);
      else {
        // Intermediate Picker events do not settle the choice.
      }
    };
    new picker.PickerBuilder()
      .setDeveloperKey(config.developerKey).setAppId(config.appId).setOAuthToken(config.accessToken)
      .addView(view).setCallback(onEvent).build().setVisible(true);
  });
}

/** Hosted: pick, then let the server verify. */
async function chooseHosted({ client, bootstrap }) {
  const fileId = await pickHostedFileId(bootstrap.picker);
  if (fileId === null) return null;
  const { spreadsheet } = await client.call({ action: 'verify-picked', payload: { sessionId: bootstrap.picker.sessionId, fileId } });
  return spreadsheet;
}

/** Desktop: start, then poll until selected, cancelled, expired, or the person stops waiting. */
async function chooseInSystemBrowser({ client, onStatus, stopped }) {
  const { expiresAt } = await client.call({ action: 'start-system-picker', payload: {} });
  onStatus(pollText({ status: 'waiting' }));
  while (!stopped() && Date.now() < Date.parse(expiresAt) + POLL_MS) {
    await wait(POLL_MS);
    const outcome = await client.call({ action: 'finish-system-picker', payload: {} });
    if (outcome.status === 'selected') return outcome.spreadsheet;
    if (outcome.status !== 'waiting') { onStatus(pollText(outcome)); return null; }
  }
  onStatus(pollText({ status: stopped() ? 'cancelled' : 'expired' }));
  return null;
}

/**
 * Runs "Choose spreadsheet" for the bootstrap's mode.
 * @param {{ client: { call: Function }, bootstrap: { mode: string, picker?: object }, onStatus: (text: string) => void, stopped?: () => boolean }} required
 * @returns {Promise<{ spreadsheetId: string, title: string, url: string } | null>} null = nothing chosen, nothing saved.
 */
export function chooseSpreadsheet(required) {
  const { client, bootstrap, onStatus, stopped = () => false } = required;
  return bootstrap.mode === 'hosted' ? chooseHosted({ client, bootstrap }) : chooseInSystemBrowser({ client, onStatus, stopped });
}
