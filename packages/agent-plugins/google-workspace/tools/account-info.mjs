/**
 * @file Tool `account_info` (`p_google_workspace__account_info`): which Google account a
 * Google Workspace connection is signed in as. The smallest read the plugin's tools file ships with
 * until the Sheets tools land, and the first thing chat checks before it works on a spreadsheet.
 *
 * Exists so chat can name the account it will act as without ever seeing a token: the token is
 * read from the host inside the shared client and only the account label is returned.
 */
import { readAccount } from '../lib/drive-files.mjs';
import { createGoogleClient } from '../lib/http.mjs';

export default {
  /** @param {{ input: { connectionRef: string }, capabilities: { connections: object, http: object }, signal?: AbortSignal }} required */
  async invoke({ input, capabilities, signal }) {
    const client = createGoogleClient({ http: capabilities.http, connections: capabilities.connections });
    return readAccount({ client, connectionRef: input.connectionRef }, signal ? { signal } : {});
  },
};
