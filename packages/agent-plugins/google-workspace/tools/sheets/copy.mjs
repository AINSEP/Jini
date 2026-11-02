/**
 * @file Tool `sheets_copy` (`p_google_workspace__sheets_copy`): a whole-spreadsheet copy through
 * Drive `files.copy` (the shared Drive helper), optionally into a folder the connection can open.
 *
 * A copy is not idempotent: a lost answer is `uncertain-outcome` and is never replayed.
 */
import { copyFile } from '../../lib/drive-files.mjs';
import { sheetsClientFor, resourceLines } from '../../lib/sheets-client.mjs';

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, title: string, parentFolderId?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke({ input, capabilities, signal }) {
    const copied = await copyFile(
      { client: sheetsClientFor({ capabilities }), connectionRef: input.connectionRef, fileId: input.spreadsheetId, name: input.title },
      { ...(input.parentFolderId ? { parentId: input.parentFolderId } : {}), ...(signal ? { signal } : {}) },
    );
    return { spreadsheetId: copied.fileId, title: copied.name, url: copied.url };
  },
  describeAffectedResources({ input }) {
    const where = input.parentFolderId ? ` in folder ${input.parentFolderId}` : '';
    return resourceLines({ lines: [`New spreadsheet "${input.title}" copied from spreadsheet ${input.spreadsheetId}${where}`] });
  },
};
