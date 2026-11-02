/**
 * @file Form destination `google-sheets` (push only): appends each accepted form submission as one
 * row of the tab its binding names, through the same Google client the Sheets tools use.
 *
 * Exists to turn one frozen delivery job (form, submission, binding config, all fixed when the
 * submission was planned) into at most one spreadsheet row, and to report the outcome in the forms
 * delivery contract's vocabulary. Per attempt it: refuses while the Sheets product is off; finds
 * the tab by its numeric sheet id (renames are safe); matches columns by their field markers and
 * headers (`mapping.mjs`); scans the `_tovu_submission_id` column for this submission
 * (`dedupe.mjs`) and stops as delivered when the row is already there (more than one such row is
 * reported as delivered, never appended again; its "review" note is dropped by the ledger); in one atomic batch grows the
 * grid, writes the new headers and tags new field columns; appends the row with RAW values. An append whose answer was lost is never replayed: the column is scanned again,
 * and when the row is not found the job reports `outcome-unknown`, so the next attempt scans before
 * appending. Delivery is at-least-once with best-effort dedupe; nothing here claims exactly-once.
 *
 * Binding config (non-secret, frozen per job):
 * `{ spreadsheetId: string, tabs: { [formSlug]: { sheetId: number } } }`. Which column holds which
 * field lives in the sheet itself (column markers), not in the binding.
 */
import { columnName, parseA1Range, tabRange } from '../lib/sheets-a1.mjs';
import { googleClientFor, sheetsUrl } from '../lib/sheets-client.mjs';
import { isProductEnabled } from '../lib/product-state.mjs';
import { GoogleWorkspaceError } from '../lib/request-policy.mjs';
import { findSubmissionRows } from './dedupe.mjs';
import { DeliveryRefusal, failureResult, resultForError } from './delivery-result.mjs';
import { FIELD_MARKER_KEY, buildMapping, buildRow, planColumns, readMarkers } from './mapping.mjs';

/** Per-request cap passed to the host kit; a request that runs past it counts as a lost answer. */
export const DELIVERY_REQUEST_TIMEOUT_MS = 15_000;
const TAB_FIELDS = 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))';

const configurationInvalid = () => new DeliveryRefusal({ code: 'configuration-invalid', retryable: false });

/**
 * The spreadsheet and tab this form's rows go to, from the frozen binding config.
 * @throws {DeliveryRefusal} `configuration-invalid` when the config does not name them properly.
 * @complexity O(1).
 */
function targetFor({ binding, form }) {
  const { spreadsheetId, tabs } = binding.config ?? {};
  const tab = tabs && Object.hasOwn(tabs, form.slug) ? tabs[form.slug] : undefined;
  if (typeof spreadsheetId !== 'string' || !Number.isInteger(tab?.sheetId) || tab.sheetId < 0) throw configurationInvalid();
  return { spreadsheetId, tab };
}

const a1 = (title, cells) => tabRange({ title, cells });

/**
 * The Sheets requests one delivery makes, over the shared Google client.
 * @complexity O(1) to build; each call is one request (plus the client's retries).
 */
function sheetsRequests({ client, connectionRef, spreadsheetId }) {
  const send = (request) => client.request({ connectionRef, ...request });
  const valuesUrl = (range, method) => sheetsUrl({ spreadsheetId }, { segments: ['values', range], ...(method ? { method } : {}) });
  return {
    async tab(sheetId) {
      const body = await send({ kind: 'read', url: sheetsUrl({ spreadsheetId }), query: { fields: TAB_FIELDS } });
      const properties = (body?.sheets ?? []).map((sheet) => sheet?.properties).find((entry) => entry?.sheetId === sheetId);
      // The tab was deleted (or never existed): the person picks the tab again.
      if (typeof properties?.title !== 'string') throw configurationInvalid();
      const grid = properties.gridProperties ?? {};
      return { sheetId, title: properties.title, rowCount: grid.rowCount ?? 0, columnCount: grid.columnCount ?? 0 };
    },
    async rows(range) {
      return (await send({ kind: 'read', url: valuesUrl(range), query: { majorDimension: 'ROWS' } }))?.values ?? [];
    },
    async markers(sheetId) {
      const lookup = { metadataKey: FIELD_MARKER_KEY, locationType: 'COLUMN', metadataLocation: { sheetId }, locationMatchingStrategy: 'INTERSECTING_LOCATION' };
      // A search changes nothing: `read` lets the client retry it.
      const body = await send({ kind: 'read', method: 'POST', url: sheetsUrl({ spreadsheetId }, { segments: ['developerMetadata'], method: ':search' }), body: { dataFilters: [{ developerMetadataLookup: lookup }] } });
      return readMarkers({ matches: Array.isArray(body?.matchedDeveloperMetadata) ? body.matchedDeveloperMetadata : [], sheetId });
    },
    async batch(changes) {
      // Adds columns and metadata, so a replay could apply twice: a `write`, never replayed when its outcome is unknown.
      await send({ kind: 'write', method: 'POST', url: sheetsUrl({ spreadsheetId }, { method: ':batchUpdate' }), body: { requests: changes } });
    },
    async append(range, row) {
      const body = await send({ kind: 'write', method: 'POST', url: valuesUrl(range, ':append'), query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { range, majorDimension: 'ROWS', values: [row] } });
      return body?.updates?.updatedRange;
    },
  };
}

/** The rows of `tab` holding the submission id, in the id column at `idColumn`. @complexity see `findSubmissionRows`. */
function scanFor(requests, tab, idColumn, submissionId) {
  const column = columnName({ index: idColumn });
  return findSubmissionRows({ rowCount: tab.rowCount, submissionId, readColumn: ({ from, to }) => requests.rows(a1(tab.title, `${column}${from}:${column}${to}`)) });
}

/**
 * Success, naming where the row is (sheet id and row numbers only: no titles, no values). More than
 * one row with this submission id (another writer, or a late append) is still delivered, never
 * appended again. The reference names the rows for review, but the forms ledger keeps only `ok`
 * (the contract has no reviewable success), so today no person sees it; see the README.
 * @complexity O(rows).
 */
function delivered(sheetId, rows) {
  if (rows.length === 0) return { ok: true, reference: `sheet ${sheetId}` };
  if (rows.length === 1) return { ok: true, reference: `sheet ${sheetId} row ${rows[0]}` };
  return { ok: true, reference: `sheet ${sheetId} rows ${rows.join(', ')} (duplicate submission id: review)` };
}

/** `updateCells` writing the new headers into row 1 as text (a header can never become a formula). @complexity O(headers). */
function headerCells(sheetId, newHeaders) {
  const values = newHeaders.map(({ header }) => ({ userEnteredValue: { stringValue: header } }));
  return { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: newHeaders[0].index }, rows: [{ values }], fields: 'userEnteredValue' } };
}

/** `createDeveloperMetadata` tagging one column with the field id it holds. @complexity O(1). */
function markerRequest(sheetId, { field, index }) {
  const location = { dimensionRange: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 } };
  return { createDeveloperMetadata: { developerMetadata: { metadataKey: FIELD_MARKER_KEY, metadataValue: field, visibility: 'DOCUMENT', location } } };
}

/**
 * Before the row that needs them: grows the grid, writes new headers and tags untagged field
 * columns, in ONE atomic batch, so a half-prepared tab can never be left behind.
 * @complexity O(new headers + untagged columns).
 */
async function prepareColumns(requests, tab, layout) {
  const changes = [
    ...(layout.width > tab.columnCount ? [{ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: layout.width - tab.columnCount } }] : []),
    ...(layout.newHeaders.length > 0 ? [headerCells(tab.sheetId, layout.newHeaders)] : []),
    ...layout.untagged.map((column) => markerRequest(tab.sheetId, column)),
  ];
  if (changes.length > 0) await requests.batch(changes);
}

/**
 * After an append whose answer was lost: scan again (the tab may have grown). Found → delivered.
 * Not found, or the scan itself failed → `outcome-unknown`, retryable: the next attempt scans
 * before it appends, which also gives a late append time to land.
 * @complexity see `findSubmissionRows`.
 */
async function confirmUncertainAppend(requests, sheetId, idColumn, submissionId) {
  try {
    const rows = await scanFor(requests, await requests.tab(sheetId), idColumn, submissionId);
    if (rows.length > 0) return delivered(sheetId, rows);
  } catch {
    // A failed re-scan proves nothing either way; the outcome stays unknown.
  }
  return failureResult({ code: 'outcome-unknown', retryable: true, outcome: 'unknown' });
}

const isUncertain = (error) => error instanceof GoogleWorkspaceError && error.code === 'uncertain-outcome';

/** Appends the row once; a lost answer is re-checked, never replayed. @complexity O(1) requests plus a re-scan. */
async function appendOnce(requests, tab, layout, row, submissionId) {
  try {
    const updatedRange = await requests.append(a1(tab.title, 'A1'), row);
    const startRow = parseA1Range({ range: updatedRange })?.startRow;
    return delivered(tab.sheetId, startRow === undefined ? [] : [startRow]);
  } catch (error) {
    if (!isUncertain(error)) throw error;
    return confirmUncertainAppend(requests, tab.sheetId, layout.columns[0], submissionId);
  }
}

/** The product this destination belongs to (`products.json`). */
const SHEETS_PRODUCT = 'sheets';

/** One delivery attempt; throws for every failure (mapped by the caller). @complexity O(rowCount / chunk) requests. */
async function deliverRow(required, optional) {
  // Retryable, but not a pause: the forms retry policy re-tries it (about 8 attempts over about a
  // day) and then marks the job failed.
  // Off unless the plugin's own settings say Sheets is on: no state reader never enables delivery.
  if (!(await isProductEnabled({ state: optional.state, productId: SHEETS_PRODUCT }))) throw new DeliveryRefusal({ code: 'adapter-unavailable', retryable: true });
  const { spreadsheetId, tab: tabConfig } = targetFor(required);
  // One token read per Google request when the host offers it (OAuth: budgets count every request
  // and the job's frozen account is re-checked); a plain credential carries just `token`.
  const { credential } = required;
  const connections = { getAccessToken: () => (credential.getAccessToken ? credential.getAccessToken() : Promise.resolve(credential.token)) };
  const client = googleClientFor({ capabilities: { http: { fetch: ({ url }, init) => required.kit.fetch(url, init, { timeoutMs: DELIVERY_REQUEST_TIMEOUT_MS }) }, connections } });
  const requests = sheetsRequests({ client, connectionRef: required.binding.connectionRef, spreadsheetId });
  const tab = await requests.tab(tabConfig.sheetId);
  const mapping = buildMapping({ form: required.form });
  const headerRow = (await requests.rows(a1(tab.title, '1:1')))[0] ?? [];
  const layout = planColumns({ mapping, headerRow, markers: await requests.markers(tab.sheetId) });
  const existing = await scanFor(requests, tab, layout.columns[0], required.submission.id);
  if (existing.length > 0) return delivered(tab.sheetId, existing);
  await prepareColumns(requests, tab, layout);
  return appendOnce(requests, tab, layout, buildRow({ mapping, ...layout, submission: required.submission }), required.submission.id);
}

export default {
  /**
   * The forms delivery contract's `deliver`. Never throws: every failure is a contract result.
   * @param {{ kit: { fetch(url: string, init: RequestInit, options: { timeoutMs: number }): Promise<Response> }, credential: { token: string, getAccessToken?: () => Promise<string> }, form: { slug: string, fields: readonly { name: string, label?: string }[] }, submission: { id: string, answers: Readonly<Record<string, unknown>>, submittedAt: string }, binding: { connectionRef: string, config: Readonly<Record<string, unknown>> }, idempotencyKey?: string }} required
   * @param {{ state?: { get(input: { key: string }): Promise<unknown> } }} [optional]
   *   `state`: the host's read-only reader of this plugin's settings, the same store and gate the
   *   tools use (`isProductEnabled`); absent = Sheets off. Quotas are the host's budgets, charged
   *   on every token read (`credential.getAccessToken`).
   * @returns {Promise<{ ok: true, reference?: string } | { ok: false, error: { code: string, retryable: boolean, retryAfterMs?: number, outcome?: 'not-applied' | 'unknown' } }>}
   */
  async deliver(required, optional = {}) {
    try {
      return await deliverRow(required, optional);
    } catch (error) {
      return resultForError({ error });
    }
  },
};
