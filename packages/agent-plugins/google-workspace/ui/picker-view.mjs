/**
 * @file What "Choose spreadsheet" says at each step: pure text for the bootstrap modes and the desktop
 * poll outcomes, shared by the Picker panel and the form-destination panel. No DOM, so the rule that
 * a cancel changes nothing is stated (and testable) in one place.
 */

/** Shown whenever a form destination is saved or removed: local deletes never purge Google's rows. */
export const EXTERNAL_ROWS_NOTE = 'Rows this site writes stay in the spreadsheet: removing this destination, or deleting the form or its submissions on this site, does not delete them.';

export const CANCELLED_TEXT = 'No spreadsheet was chosen. Your saved settings did not change.';

const POLL_TEXT = Object.freeze({
  waiting: 'Choose the spreadsheet in your browser. Use the "Continue to sign-in" button the admin page shows above this panel; Google opens its file picker after the sign-in.',
  expired: 'The file picker link expired before a spreadsheet was chosen. Your saved settings did not change; start again.',
  none: 'No file picker is open. Start again.',
  cancelled: CANCELLED_TEXT,
});

/**
 * The line shown for a bootstrap mode before anything is chosen.
 * @param {{ bootstrap: { mode: string, message?: string } | undefined }} required
 * @returns {string}
 */
export function pickerIntro(required, _optional = {}) {
  const { bootstrap } = required;
  if (bootstrap === undefined) return 'The panel did not receive its start data in time. Close it and open it again.';
  if (bootstrap.mode === 'unavailable') return bootstrap.message ?? 'Google Sheets is not ready. Check the Google Workspace connection panel.';
  if (bootstrap.mode === 'hosted') return 'Choose a Google Sheets spreadsheet. This site gets access to that one file only.';
  return 'Choose a Google Sheets spreadsheet. Google\'s file picker opens in your browser; this site gets access to that one file only.';
}

/**
 * The line for a desktop poll outcome (`selected` is rendered by the caller with the file's title).
 * @param {{ status: 'waiting' | 'expired' | 'none' | 'cancelled' }} required
 * @returns {string}
 */
export function pollText(required, _optional = {}) {
  return POLL_TEXT[required.status] ?? POLL_TEXT.none;
}

/** The line for a verified selection. */
export function selectedText(required, _optional = {}) {
  return `Chosen: ${required.spreadsheet.title}.`;
}
