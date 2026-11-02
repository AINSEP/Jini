/**
 * @file The reviewed inventory of Sheets `spreadsheets.batchUpdate` request kinds the Google
 * Workspace tools may send, and the one check every batch passes before it reaches Google (the raw
 * `batch_update` tool and every named wrapper: tab, sort, filter, format, named ranges).
 *
 * Exists because a raw batch tool is the broad-coverage escape hatch, so it must fail closed: only
 * kinds listed here are sent; an unknown, misspelt or preview kind is refused before any request.
 * Each listed kind carries:
 * - `effect`: `destructive` when it deletes something, overwrites or moves cell values, or changes
 *   protection; otherwise `write`. The confirmation card names every kind with its effect.
 * - `replay`: `unsafe` when sending the same request twice can change the sheet twice (adds,
 *   inserts, appends, deletes by index, moves, find/replace, randomize). A batch holding one is a
 *   `write` for the HTTP client, so an unknown outcome is `uncertain-outcome` and never replayed.
 * - `requires`: the fields Google needs; an inner array means "at least one of". `fields` (the field
 *   mask) must be explicit: `*` would reset every property the request does not set.
 *
 * Reviewed against the Request union of Sheets API v4
 * (https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request).
 * Deliberately NOT listed (refused as unsupported): the data-source kinds (`addDataSource`,
 * `updateDataSource`, `deleteDataSource`, `refreshDataSource`, `cancelDataSourceRefresh`). They need
 * Connected Sheets and a BigQuery permission that this sign-in never requests (drive.file only);
 * offering them would only produce permission failures. Adding a kind means reviewing it against the
 * reference and adding one row here.
 */
import { GoogleWorkspaceError } from './request-policy.mjs';

export const MAX_BATCH_REQUESTS = 100;
export const MAX_BATCH_BYTES = 1024 * 1024;
/** The confirmation card shows at most 50 lines: one for the spreadsheet, one per kind. */
export const MAX_DISTINCT_KINDS = 48;

const W = 'write';
const D = 'destructive';
const SAFE = 'idempotent';
const UNSAFE = 'unsafe';

/** [kind, effect, replay, requires] */
const ROWS = [
  ['updateSpreadsheetProperties', W, SAFE, ['properties', 'fields']],
  // Shrinking gridProperties.rowCount/columnCount deletes cells.
  ['updateSheetProperties', D, SAFE, ['properties', 'fields']],
  ['updateDimensionProperties', W, SAFE, ['properties', 'fields', ['range', 'dataSourceSheetRange']]],
  ['updateNamedRange', W, SAFE, ['namedRange', 'fields']],
  ['repeatCell', D, SAFE, ['range', 'cell', 'fields']],
  ['addNamedRange', W, UNSAFE, ['namedRange']],
  ['deleteNamedRange', D, SAFE, ['namedRangeId']],
  ['addSheet', W, UNSAFE, []],
  ['deleteSheet', D, SAFE, ['sheetId']],
  ['autoFill', D, SAFE, [['range', 'sourceAndDestination']]],
  ['cutPaste', D, UNSAFE, ['source', 'destination']],
  ['copyPaste', D, SAFE, ['source', 'destination']],
  ['mergeCells', D, SAFE, ['range', 'mergeType']],
  ['unmergeCells', W, SAFE, ['range']],
  ['updateBorders', W, SAFE, ['range']],
  ['updateCells', D, SAFE, ['rows', 'fields', ['start', 'range']]],
  ['addFilterView', W, UNSAFE, ['filter']],
  ['appendCells', W, UNSAFE, ['sheetId', 'rows', 'fields']],
  ['clearBasicFilter', W, SAFE, ['sheetId']],
  ['deleteDimension', D, UNSAFE, ['range']],
  ['deleteEmbeddedObject', D, SAFE, ['objectId']],
  ['deleteFilterView', D, SAFE, ['filterId']],
  ['duplicateFilterView', W, UNSAFE, ['filterId']],
  ['duplicateSheet', W, UNSAFE, ['sourceSheetId']],
  ['findReplace', D, UNSAFE, ['find', ['range', 'sheetId', 'allSheets']]],
  ['insertDimension', W, UNSAFE, ['range']],
  ['insertRange', W, UNSAFE, ['range', 'shiftDimension']],
  ['moveDimension', W, UNSAFE, ['source', 'destinationIndex']],
  ['updateEmbeddedObjectPosition', W, SAFE, ['objectId', 'newPosition', 'fields']],
  ['pasteData', D, SAFE, ['coordinate', 'data']],
  ['textToColumns', D, UNSAFE, ['source']],
  ['updateFilterView', W, SAFE, ['filter', 'fields']],
  ['deleteRange', D, UNSAFE, ['range', 'shiftDimension']],
  ['appendDimension', W, UNSAFE, ['sheetId', 'dimension', 'length']],
  ['addConditionalFormatRule', W, UNSAFE, ['rule', 'index']],
  ['updateConditionalFormatRule', W, UNSAFE, ['index', 'sheetId', ['rule', 'newIndex']]],
  ['deleteConditionalFormatRule', D, UNSAFE, ['index', 'sheetId']],
  ['sortRange', D, SAFE, ['range', 'sortSpecs']],
  ['setDataValidation', W, SAFE, ['range']],
  // A basic filter's sortSpecs physically reorder the rows, like sortRange.
  ['setBasicFilter', D, SAFE, ['filter']],
  ['addProtectedRange', D, UNSAFE, ['protectedRange']],
  ['updateProtectedRange', D, SAFE, ['protectedRange', 'fields']],
  ['deleteProtectedRange', D, SAFE, ['protectedRangeId']],
  ['autoResizeDimensions', W, SAFE, [['dimensions', 'dataSourceSheetDimensions']]],
  ['addChart', W, UNSAFE, ['chart']],
  ['updateChartSpec', W, SAFE, ['chartId', 'spec']],
  ['updateBanding', W, SAFE, ['bandedRange', 'fields']],
  ['addBanding', W, UNSAFE, ['bandedRange']],
  ['deleteBanding', D, SAFE, ['bandedRangeId']],
  ['createDeveloperMetadata', W, UNSAFE, ['developerMetadata']],
  ['updateDeveloperMetadata', W, SAFE, ['dataFilters', 'developerMetadata', 'fields']],
  ['deleteDeveloperMetadata', D, SAFE, ['dataFilter']],
  ['randomizeRange', D, UNSAFE, ['range']],
  ['addDimensionGroup', W, UNSAFE, ['range']],
  ['deleteDimensionGroup', D, UNSAFE, ['range']],
  ['updateDimensionGroup', W, SAFE, ['dimensionGroup', 'fields']],
  ['trimWhitespace', D, SAFE, ['range']],
  ['deleteDuplicates', D, SAFE, ['range']],
  ['updateEmbeddedObjectBorder', W, SAFE, ['objectId', 'border', 'fields']],
  ['addSlicer', W, UNSAFE, ['slicer']],
  ['updateSlicerSpec', W, SAFE, ['slicerId', 'spec', 'fields']],
  ['addTable', W, UNSAFE, ['table']],
  ['updateTable', W, SAFE, ['table', 'fields']],
  ['deleteTable', D, SAFE, ['tableId']],
];

/** kind → `{ effect, replay, requires }`, frozen. */
export const REQUEST_KINDS = Object.freeze(Object.fromEntries(ROWS.map(([kind, effect, replay, requires]) => [kind, Object.freeze({ effect, replay, requires })])));

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const refuse = (code, detail) => new GoogleWorkspaceError({ code }, { detail });

/** Whether one requirement (a field, or "one of" these fields) is present. @complexity O(1). */
function satisfied(body, requirement) {
  return [requirement].flat().some((field) => body[field] !== undefined && body[field] !== null);
}

/** What is wrong with a listed kind's body, or undefined. @complexity O(f). */
function bodyProblem(entry, body) {
  const missing = entry.requires.find((requirement) => !satisfied(body, requirement));
  if (missing) return `needs ${[missing].flat().join(' or ')}`;
  const explicitMask = typeof body.fields === 'string' && body.fields.trim() !== '' && !body.fields.includes('*');
  return body.fields === undefined || explicitMask ? undefined : 'needs an explicit field mask, not *';
}

/**
 * The listed kind of one request, or the refusal that stops the whole batch.
 * @complexity O(f) fields of the kind's requirements.
 */
function checkOne(request, index) {
  const keys = isPlainObject(request) ? Object.keys(request) : [];
  if (keys.length !== 1) return { error: refuse('invalid-input', `request ${index + 1} must name exactly one request kind`) };
  const kind = keys[0];
  // Own-property lookup only, so `constructor` or `__proto__` can never pass as a kind.
  const entry = Object.hasOwn(REQUEST_KINDS, kind) ? REQUEST_KINDS[kind] : undefined;
  if (!entry) return { error: refuse('unsupported-request', `request ${index + 1}`) };
  const body = request[kind];
  if (!isPlainObject(body)) return { error: refuse('invalid-input', `request ${index + 1} (${kind}) must be an object`) };
  const problem = bodyProblem(entry, body);
  return problem ? { error: refuse('invalid-input', `request ${index + 1} (${kind}) ${problem}`) } : { kind, entry };
}

/** Refuses an empty, oversized or too varied batch. @complexity O(serialized size). */
function checkBounds(requests) {
  if (!Array.isArray(requests) || requests.length === 0) throw refuse('invalid-input', 'the batch has no requests');
  if (requests.length > MAX_BATCH_REQUESTS) throw refuse('limit-exceeded', `at most ${MAX_BATCH_REQUESTS} requests per batch`);
  if (Buffer.byteLength(JSON.stringify(requests)) > MAX_BATCH_BYTES) throw refuse('limit-exceeded', 'at most 1 MiB of requests per batch');
}

/**
 * Checks a whole batch against the inventory. Nothing is sent unless every request passes.
 * @param {{ requests: unknown }} required
 * @returns {{ kind: 'write' | 'idempotent-write', kinds: Map<string, { effect: string, count: number }> }}
 *   `kind` is what the HTTP client needs to know about replays; `kinds` is in first-seen order.
 * @throws {GoogleWorkspaceError} `invalid-input`, `unsupported-request` or `limit-exceeded`.
 * @complexity O(n) requests plus their serialized size.
 */
export function checkRequests(required, _optional = {}) {
  checkBounds(required.requests);
  const kinds = new Map();
  let unsafe = false;
  required.requests.forEach((request, index) => {
    const checked = checkOne(request, index);
    if (checked.error) throw checked.error;
    unsafe ||= checked.entry.replay === UNSAFE;
    kinds.set(checked.kind, { effect: checked.entry.effect, count: (kinds.get(checked.kind)?.count ?? 0) + 1 });
  });
  if (kinds.size > MAX_DISTINCT_KINDS) throw refuse('limit-exceeded', `at most ${MAX_DISTINCT_KINDS} different request kinds per batch`);
  return { kind: unsafe ? 'write' : 'idempotent-write', kinds };
}

/**
 * One confirmation line per request kind in the batch: `deleteDimension x2 (destructive)`.
 * @param {{ requests: unknown }} required
 * @complexity O(n).
 */
export function describeRequests(required, _optional = {}) {
  const { kinds } = checkRequests(required);
  return [...kinds].map(([kind, { effect, count }]) => `${kind} x${count} (${effect})`);
}
