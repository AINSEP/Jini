/**
 * @file Tool `sheets_values_by_data_filter` (`p_google_workspace__sheets_values_by_data_filter`):
 * reads, overwrites or clears the values matching data filters (`values.batchGetByDataFilter`,
 * `batchUpdateByDataFilter`, `batchClearByDataFilter`), chosen by `action`.
 *
 * One tool covers three actions, so it is declared destructive (the strictest of them): even a `get`
 * shows the confirmation card. Reads share the values-read output budget and carry `continuation`;
 * writes go in `RAW` unless `USER_ENTERED` is asked for and stay under 1 MiB.
 */
import {
  assertPayloadWithin, boundValueRanges, cellCount, readOptions, resourceLines, sendSheetsRequest, sheetsUrl, valueInputOption,
} from '../../lib/sheets-client.mjs';

/** Per action: endpoint, request kind, body and result. Inputs already passed the action's schema branch. */
const ACTIONS = {
  get: {
    method: ':batchGetByDataFilter', kind: 'read',
    body: (input) => ({ dataFilters: input.dataFilters, ...readOptions({ input }) }),
    result: (body) => ({ valueRanges: boundValueRanges({ valueRanges: (body?.valueRanges ?? []).map((matched) => matched.valueRange ?? { range: '', values: [] }) }) }),
  },
  update: {
    method: ':batchUpdateByDataFilter', kind: 'idempotent-write',
    body: (input) => assertPayloadWithin({ value: {
      valueInputOption: valueInputOption({ option: input.valueInputOption }), includeValuesInResponse: false,
      data: input.data.map(({ dataFilter, values }) => ({ dataFilter, majorDimension: 'ROWS', values })),
    } }),
    result: (body) => ({ totalUpdatedRows: body?.totalUpdatedRows, totalUpdatedCells: body?.totalUpdatedCells, totalUpdatedSheets: body?.totalUpdatedSheets }),
  },
  clear: {
    method: ':batchClearByDataFilter', kind: 'idempotent-write',
    body: (input) => ({ dataFilters: input.dataFilters }),
    result: (body) => ({ clearedRanges: body?.clearedRanges ?? [] }),
  },
};

/** A data filter as a card phrase; never cell values. @complexity O(1). */
function describeFilter(filter) {
  if (filter.a1Range) return `range ${filter.a1Range}`;
  // No fallback tab id: the input schema requires gridRange.sheetId, and the projection only hands
  // schema-checked input to describeAffectedResources (pinned in sheets.contract.test.mjs).
  if (filter.gridRange) return `grid range on tab ${filter.gridRange.sheetId}`;
  return 'cells found by developer metadata';
}

export default {
  /** @param {{ input: { connectionRef: string, spreadsheetId: string, action: 'get' | 'update' | 'clear', dataFilters?: object[], data?: { dataFilter: object, values: unknown[][] }[], valueInputOption?: string, valueRenderOption?: string, dateTimeRenderOption?: string }, capabilities: object, signal?: AbortSignal }} call */
  async invoke(call) {
    const { input } = call;
    const action = ACTIONS[input.action];
    const body = await sendSheetsRequest({ call, request: {
      kind: action.kind, method: 'POST', body: action.body(input),
      url: sheetsUrl({ spreadsheetId: input.spreadsheetId }, { segments: ['values'], method: action.method }),
    } });
    return action.result(body);
  },
  describeAffectedResources({ input }) {
    const where = `of spreadsheet ${input.spreadsheetId}`;
    if (input.action === 'update') return resourceLines({ lines: input.data.map(({ dataFilter, values }) => `Overwrite ${describeFilter(dataFilter)} ${where} (${cellCount({ values })} cell(s); current values are replaced)`) });
    const verb = input.action === 'clear' ? 'Clear every value in' : 'Read values in';
    return resourceLines({ lines: input.dataFilters.map((filter) => `${verb} ${describeFilter(filter)} ${where}`) });
  },
};
