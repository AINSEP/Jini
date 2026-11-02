/**
 * @file The one Sheets client of the Google Workspace plugin: every Sheets tool (values, search,
 * tabs, filters, formatting, batch updates, export) and the form destination build their endpoint,
 * check and encode ids and ranges, apply the RAW input default and enforce the §D bounds here, then
 * send through the one Google client (`http.mjs`), which owns tokens, retries and safe errors
 * (quotas are the host's, charged on each token read). A1 helpers live in `sheets-a1.mjs`.
 *
 * Exists so the rules that keep a call inside what the person asked for live in one place:
 * - a spreadsheet id must look like a Google file id ({@link assertSpreadsheetId}) and, like a
 *   range, is ONE encoded path segment (`.`/`..` refused), so caller text can never change which
 *   endpoint is called;
 * - every batch, raw or built by a named tool, passes the reviewed request-kind inventory first
 *   ({@link runBatchUpdate});
 * - values are written `RAW` unless the caller explicitly asks for `USER_ENTERED`, so text a
 *   visitor typed never becomes a formula;
 * - reads return at most 500 rows, 5,000 cells and 64 KiB, with an explicit continuation range
 *   instead of a silent partial; mutation payloads stay under 1 MiB;
 * - every request a Sheets tool sends first checks that the Sheets product is on
 *   ({@link sheetsClientFor}), so turning Sheets off blocks every Sheets tool at once.
 */
import { createGoogleClient, pathSegment } from './http.mjs';
import { assertProductEnabled } from './product-state.mjs';
import { GoogleWorkspaceError } from './request-policy.mjs';
import { parseA1Range } from './sheets-a1.mjs';
import { MAX_BATCH_BYTES, MAX_BATCH_REQUESTS, checkRequests } from './sheets-admin-request-kinds.mjs';

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
/** The `products.json` id every Sheets tool belongs to (its tools are named `sheets_*`). */
export const SHEETS_PRODUCT_ID = 'sheets';
export const DEFAULT_VALUE_INPUT_OPTION = 'RAW';

/** §D starting bounds. Batch reads share ONE output budget across all their ranges. */
export const SHEETS_LIMITS = Object.freeze({
  maxRows: 500, maxCells: 5_000, maxOutputBytes: 64 * 1024, maxRanges: 20,
  // One mutation bound for values writes and batch updates alike.
  maxMutationEntries: MAX_BATCH_REQUESTS, maxPayloadBytes: MAX_BATCH_BYTES,
  // find reads more than it returns: it scans up to this many cells and returns at most maxMatches.
  maxScannedCells: 50_000, maxMatches: 100, maxExcerptChars: 120,
});

/** Default spreadsheet metadata mask: no grid data, only what chat needs to name tabs. */
const SHEET_PROPERTIES = 'properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount))';
const SPREADSHEET_PREFIX = 'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone)';
export const SPREADSHEET_FIELDS = `${SPREADSHEET_PREFIX},sheets(${SHEET_PROPERTIES})`;
const GRID_DATA_FIELDS = `${SPREADSHEET_PREFIX},sheets(${SHEET_PROPERTIES},data(startRow,startColumn,rowData(values(formattedValue))))`;

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');

/** Google file ids are URL-safe base64 characters; the input schemas use the same pattern. */
export const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * The id, when it is a plausible Google file id; refused before it reaches any URL otherwise (the
 * value is never echoed).
 * @param {{ id: unknown }} required
 * @param {{ code?: 'invalid-input' | 'invalid-selection' }} [optional] The Picker refuses with
 *   `invalid-selection` (re-pick the file); tools with `invalid-input` (the default).
 * @throws {GoogleWorkspaceError}
 * @complexity O(n) characters.
 */
export function assertSpreadsheetId(required, optional = {}) {
  if (typeof required.id === 'string' && SPREADSHEET_ID_PATTERN.test(required.id)) return required.id;
  const code = optional.code ?? 'invalid-input';
  throw new GoogleWorkspaceError({ code }, code === 'invalid-input' ? { detail: 'spreadsheetId' } : {});
}

/**
 * `<SHEETS_API>/<spreadsheetId>[/<segment>…][<method>]`, the id checked first. `method`
 * (`:append`, `:batchUpdate`, …) is always a constant from plugin code, never caller text.
 * @param {{ spreadsheetId: string }} required
 * @param {{ segments?: readonly string[], method?: string }} [optional]
 * @throws {GoogleWorkspaceError} `invalid-input` for an id or segment that cannot be a path segment.
 * @complexity O(n) characters.
 */
export function sheetsUrl(required, optional = {}) {
  const segments = [assertSpreadsheetId({ id: required.spreadsheetId }), ...(optional.segments ?? [])].map((value) => pathSegment({ value }));
  return `${SHEETS_API}/${segments.join('/')}${optional.method ?? ''}`;
}

/**
 * Sends one Sheets request for a tool call through the shared Google client.
 * @param {{ call: { input: { connectionRef: string }, capabilities: { http: object, connections: object, state?: object }, signal?: AbortSignal }, request: { url: string, method?: string, query?: object, body?: unknown, kind: 'read' | 'idempotent-write' | 'write' } }} required
 *   `call` is the tool's `invoke` argument as received.
 * @returns {Promise<any>} Google's parsed JSON body.
 * @throws {GoogleWorkspaceError} Every failure, already mapped to a safe code.
 * @complexity O(attempts) (see `createGoogleClient`).
 */
export function sendSheetsRequest(required, _optional = {}) {
  const { input, capabilities, signal } = required.call;
  return sheetsClientFor({ capabilities }).request({ connectionRef: input.connectionRef, ...required.request }, signal ? { signal } : {});
}

/** The shared Google client over one call's host capabilities. @complexity O(1). */
export function googleClientFor(required, _optional = {}) {
  const { capabilities } = required;
  return createGoogleClient({ http: capabilities.http, connections: capabilities.connections });
}

/**
 * The Google client a Sheets tool uses: each request first checks that the Sheets product is on in
 * the plugin's settings (`capabilities.state`), then goes through the shared client. Checked per
 * request, so turning Sheets off also stops a multi-request call (an export) part way, before the
 * next request is sent.
 * @param {{ capabilities: { http: object, connections: object, state?: { get(input: { key: string }): Promise<unknown> } } }} required
 * @throws {GoogleWorkspaceError} `product-disabled` from `request` while Sheets is off.
 * @complexity O(1) to build; each request adds one state read.
 */
export function sheetsClientFor(required, _optional = {}) {
  const { capabilities } = required;
  const client = googleClientFor({ capabilities });
  return {
    async request(request, options = {}) {
      await assertProductEnabled({ state: capabilities.state, productId: SHEETS_PRODUCT_ID });
      return client.request(request, options);
    },
  };
}

/** A mask that reaches cell data: `*`, or a `data` field (`sheets.data`, `sheets(data)`), not `dataSources`. */
const GRID_DATA_MASK = /\*|\bdata\b/;

/**
 * The spreadsheet field mask: the caller's, else the default (plus cell values when grid data is
 * asked for). Google ignores `includeGridData` once a mask is set, so a caller mask that reaches
 * cell data counts as asking for grid data: it needs `includeGridData` (which `sheets_get` only
 * allows with explicit ranges; `get_by_data_filter` always names its data filters).
 * @throws {GoogleWorkspaceError} `invalid-input` for a grid-data mask without `includeGridData`.
 * @complexity O(n) mask length.
 */
export function spreadsheetFields(required, _optional = {}) {
  if (required.fields !== undefined && GRID_DATA_MASK.test(required.fields) && !required.includeGridData) {
    throw new GoogleWorkspaceError({ code: 'invalid-input' }, { detail: 'a fields mask with * or data needs includeGridData and ranges' });
  }
  if (required.fields !== undefined) return required.fields;
  return required.includeGridData ? GRID_DATA_FIELDS : SPREADSHEET_FIELDS;
}

const MAX_RESOURCE_LINES = 50;
const MAX_RESOURCE_CHARS = 300;

/**
 * Lines for the confirmation card, inside the projection's bounds (50 lines of 300 characters):
 * a long line is shortened and extra lines are summarized as a count, so nothing is hidden silently.
 * @complexity O(lines).
 */
export function resourceLines(required, _optional = {}) {
  const fit = (line) => (line.length > MAX_RESOURCE_CHARS ? `${line.slice(0, MAX_RESOURCE_CHARS - 1)}…` : line);
  const { lines } = required;
  if (lines.length <= MAX_RESOURCE_LINES) return lines.map(fit);
  return [...lines.slice(0, MAX_RESOURCE_LINES - 1).map(fit), `… and ${lines.length - MAX_RESOURCE_LINES + 1} more`];
}

/** The value input option to send: `RAW` unless the caller explicitly chose `USER_ENTERED`. @complexity O(1). */
export function valueInputOption(required, _optional = {}) {
  return required.option === 'USER_ENTERED' ? 'USER_ENTERED' : DEFAULT_VALUE_INPUT_OPTION;
}

/** Read options every values read sends: rows-major, plus the caller's render choices. @complexity O(1). */
export function readOptions(required, _optional = {}) {
  const { valueRenderOption, dateTimeRenderOption } = required.input;
  return { majorDimension: 'ROWS', ...(valueRenderOption ? { valueRenderOption } : {}), ...(dateTimeRenderOption ? { dateTimeRenderOption } : {}) };
}

/** Total cells in rows of values. @complexity O(rows). */
export function cellCount(required, _optional = {}) {
  return required.values.reduce((total, row) => total + row.length, 0);
}

/**
 * Refuses a mutation whose serialized body exceeds the payload bound, before anything is sent.
 * @throws {GoogleWorkspaceError} `limit-exceeded`.
 * @complexity O(n) serialized size.
 */
export function assertPayloadWithin(required, _optional = {}) {
  if (byteLength(required.value) > SHEETS_LIMITS.maxPayloadBytes) throw new GoogleWorkspaceError({ code: 'limit-exceeded' });
  return required.value;
}

/**
 * Whether a result fits the tool-output bound, less `headroomBytes` (room a caller keeps for the
 * rest of its answer).
 * @complexity O(n) serialized size.
 */
export function outputFits(required, optional = {}) {
  return byteLength(required.value) <= SHEETS_LIMITS.maxOutputBytes - (optional.headroomBytes ?? 0);
}

/**
 * Returns a result only when it fits the tool-output bound; a larger result is an error, never a
 * silently cut one (used where no range continuation exists: metadata, data-filter and admin reads).
 * @throws {GoogleWorkspaceError} `limit-exceeded`.
 * @complexity O(n) serialized size.
 */
export function assertOutputWithin(required, _optional = {}) {
  if (!outputFits(required)) throw new GoogleWorkspaceError({ code: 'limit-exceeded' }, { detail: 'answer over 64 KiB; narrow it to one tab or fewer items' });
  return required.value;
}

const signalOption = (signal) => (signal ? { signal } : {});

/**
 * `spreadsheets.get` with a field mask (grid data is never requested).
 * @param {{ client: object, connectionRef: string, spreadsheetId: string, fields: string }} required
 * @param {{ signal?: AbortSignal }} [optional]
 * @complexity O(1) requests.
 */
export function getSpreadsheet(required, optional = {}) {
  return required.client.request({
    connectionRef: required.connectionRef, url: sheetsUrl({ spreadsheetId: required.spreadsheetId }), kind: 'read', query: { fields: required.fields },
  }, signalOption(optional.signal));
}

/**
 * `spreadsheets.batchUpdate` after the inventory check; a batch holding any non-replayable kind is a
 * `write`, so an unknown outcome is reported as uncertain and never replayed.
 * @param {{ client: object, connectionRef: string, spreadsheetId: string, requests: readonly object[] }} required
 * @param {{ signal?: AbortSignal }} [optional]
 * @returns {Promise<{ replies: unknown[] }>}
 * @complexity O(n) requests to check, one HTTP request.
 */
export async function runBatchUpdate(required, optional = {}) {
  const { kind } = checkRequests({ requests: required.requests });
  const body = await required.client.request({
    connectionRef: required.connectionRef, url: sheetsUrl({ spreadsheetId: required.spreadsheetId }, { method: ':batchUpdate' }),
    method: 'POST', kind, body: { requests: required.requests },
  }, signalOption(optional.signal));
  return { replies: Array.isArray(body?.replies) ? body.replies : [] };
}

/** The first line of every admin tool's disclosure. @complexity O(1). */
export function spreadsheetLine(required, _optional = {}) {
  return `spreadsheet ${assertSpreadsheetId({ id: required.spreadsheetId })}`;
}

/**
 * The tabs of a `sheets(properties(...),<part>)` answer, optionally only one tab.
 * @complexity O(t) tabs.
 */
export function tabsOf(required, _optional = {}) {
  const sheets = Array.isArray(required.body?.sheets) ? required.body.sheets : [];
  return required.sheetId === undefined ? sheets : sheets.filter((sheet) => sheet?.properties?.sheetId === required.sheetId);
}

/**
 * The range that continues `range` after its first `rows` rows, same columns.
 * @throws {GoogleWorkspaceError} `limit-exceeded` when Google's range cannot be continued, so the
 *   caller errors instead of returning an undisclosed partial read.
 * @complexity O(n) characters.
 */
export function continuationRange(required, _optional = {}) {
  const parts = parseA1Range({ range: required.range });
  if (!parts) throw new GoogleWorkspaceError({ code: 'limit-exceeded' });
  const start = `${parts.sheet}!${parts.startColumn}${parts.startRow + required.rows}`;
  return parts.endRow === undefined ? start : `${start}:${parts.endColumn}${parts.endRow}`;
}

/** Whether one more row fits the shared output budget. @complexity O(1). */
function rowFits(totals, row, rowBytes) {
  return totals.rows < SHEETS_LIMITS.maxRows && totals.cells + row.length <= SHEETS_LIMITS.maxCells && totals.bytes + rowBytes <= SHEETS_LIMITS.maxOutputBytes;
}

/**
 * Cuts value ranges to ONE shared output budget (rows, cells, bytes) in order. A cut range gets
 * `continuation`: the exact range to read next.
 * @param {{ valueRanges: readonly { range: string, values?: unknown[][] }[] }} required
 * @returns {{ range: string, values: unknown[][], continuation?: string }[]}
 * @throws {GoogleWorkspaceError} `limit-exceeded` when not even the first row fits (no progress possible).
 * @complexity O(cells).
 */
export function boundValueRanges(required, _optional = {}) {
  const totals = { rows: 0, cells: 0, bytes: 0 };
  const bounded = required.valueRanges.map((valueRange) => {
    const values = valueRange.values ?? [];
    let kept = 0;
    for (const row of values) {
      const rowBytes = byteLength(row);
      if (!rowFits(totals, row, rowBytes)) break;
      Object.assign(totals, { rows: totals.rows + 1, cells: totals.cells + row.length, bytes: totals.bytes + rowBytes });
      kept += 1;
    }
    if (kept === values.length) return { range: valueRange.range, values };
    return { range: valueRange.range, values: values.slice(0, kept), continuation: continuationRange({ range: valueRange.range, rows: kept }) };
  });
  if (totals.rows === 0 && bounded.some((entry) => entry.continuation)) throw new GoogleWorkspaceError({ code: 'limit-exceeded' });
  return bounded;
}
