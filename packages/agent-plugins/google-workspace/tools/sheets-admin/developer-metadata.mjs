/**
 * @file Tool `sheets_developer_metadata` (`p_google_workspace__sheets_developer_metadata`): read developer
 * metadata by id (`get`) or by data filters (`search`). Read only; creating, changing and deleting
 * metadata go through `batch_update`.
 *
 * Exists so chat can find the rows, columns or tabs an integration tagged. The metadata id is an
 * integer (input schema and the check here) before it becomes a URL path segment.
 */
import { assertOutputWithin, sheetsClientFor, sheetsUrl } from '../../lib/sheets-client.mjs';
import { GoogleWorkspaceError } from '../../lib/request-policy.mjs';

/** The request for one action; the metadata id is checked before it reaches the path. @complexity O(1). */
function requestFor(input) {
  if (input.action === 'search') {
    return { url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['developerMetadata'], method: ':search' }), method: 'POST', body: { dataFilters: input.dataFilters } };
  }
  if (!Number.isSafeInteger(input.metadataId) || input.metadataId < 0) throw new GoogleWorkspaceError({ code: 'invalid-input' }, { detail: 'metadataId' });
  return { url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['developerMetadata', String(input.metadataId)] }) };
}

export default {
  async invoke({ input, capabilities, signal }) {
    // A search is a POST that changes nothing: `read` lets the client retry it.
    const body = await sheetsClientFor({ capabilities }).request({ connectionRef: input.connectionRef, kind: 'read', ...requestFor(input) }, signal ? { signal } : {});
    const value = input.action === 'search' ? { matches: body?.matchedDeveloperMetadata ?? [] } : { metadata: body };
    return assertOutputWithin({ value: { action: input.action, ...value } });
  },
};
