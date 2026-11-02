/**
 * @file Tool `sheets_open_existing` (`p_google_workspace__sheets_open_existing`): work with a spreadsheet the
 * person already has. Without a `spreadsheetId` it answers `waiting` and points to the file picker;
 * with one (from a completed pick) it verifies, with the connected account, that the site can open the
 * file and that it is a spreadsheet (Drive metadata, then the Sheets API opens it: the same check as
 * a Picker selection, `verifySpreadsheetAccess`), and returns its id, title and link. Read only.
 *
 * Exists because under `drive.file` a pasted link grants nothing: only Google's picker (or the site
 * creating the file) does. Verifying through the API is the only honest answer to "can the site open
 * this?": an ungranted file is `file-not-granted` with the next action "choose it with the picker".
 * Chat receives resource metadata only; the link is built from the verified id, not taken from Google.
 */
import { verifySpreadsheetAccess } from '../../lib/picker-selection.mjs';
import { assertProductEnabled } from '../../lib/product-state.mjs';
import { SHEETS_PRODUCT_ID, assertSpreadsheetId, sheetsClientFor } from '../../lib/sheets-client.mjs';

const WAITING = Object.freeze({
  status: 'waiting',
  nextAction: 'open-picker',
  message: 'Ask the person to choose the spreadsheet with Google\'s file picker in the Google Workspace plugin (or offer to create a new one). A pasted link is not enough. Then call this again with the chosen spreadsheetId.',
});

export default {
  async invoke({ input, capabilities, signal }) {
    if (input.spreadsheetId === undefined) {
      // Sends nothing to Google, but pointing at the picker is still a Sheets action: it is gated too.
      await assertProductEnabled({ state: capabilities.state, productId: SHEETS_PRODUCT_ID });
      return WAITING;
    }
    const fileId = assertSpreadsheetId({ id: input.spreadsheetId });
    const resource = await verifySpreadsheetAccess({ client: sheetsClientFor({ capabilities }), connectionRef: input.connectionRef, fileId }, signal ? { signal } : {});
    return { status: 'selected', resource };
  },
};
