/**
 * @file An in-memory Google Sheets grid served by the local Google fake (`fake-google-http.mjs`),
 * for the form-delivery tests: spreadsheet metadata, values get/update/append, the
 * `appendDimension`, `updateCells` (row-1 text) and `createDeveloperMetadata` (column markers)
 * batch requests and `developerMetadata:search`, over 1-based rows of cells per tab.
 *
 * Exists so the Sheets form destination is exercised against the real request shapes it sends
 * (encoded A1 ranges, RAW input, INSERT_ROWS appends) without any network beyond 127.0.0.1. Like
 * Google, a write past the grid's columns is refused, an append lands after the last non-empty
 * row, and value reads omit trailing blanks. Requests without the expected access token get 401.
 */

/**
 * `'Tab ''x'''!A2:B9` → `{ title, c1, r1, c2, r2 }` (0-based columns, 1-based rows; open ends
 * undefined); undefined for a range that is not quoted this way (Google answers 400).
 */
function parseRange(raw) {
  const match = /^'((?:[^']|'')*)'!(.*)$/.exec(raw);
  if (!match) return undefined;
  const title = match[1].replaceAll("''", "'");
  const [start, end = start] = match[2].split(':');
  const cell = (text) => {
    const parts = /^([A-Z]*)(\d*)$/.exec(text);
    const column = parts[1] ? [...parts[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1 : undefined;
    return { column, row: parts[2] ? Number(parts[2]) : undefined };
  };
  const a = cell(start);
  const b = cell(end);
  return { title, c1: a.column ?? 0, r1: a.row ?? 1, c2: b.column, r2: b.row };
}

const columnLetters = (index) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

const trimRow = (row) => {
  const copy = [...row];
  while (copy.length > 0 && (copy.at(-1) === '' || copy.at(-1) === undefined)) copy.pop();
  return copy;
};

/**
 * Installs one spreadsheet on the fake.
 * @param {{ fake: { routePrefix: Function }, spreadsheetId: string, token: string, tabs: { sheetId: number, title: string, rowCount?: number, columnCount?: number, rows?: Record<number, unknown[]> }[] }} required
 * @returns {{ tab(sheetId: number): { title: string, rowCount: number, columnCount: number, rows: Map<number, unknown[]> }, rowsOf(sheetId: number): unknown[][], failNext: { status: number, headers?: Record<string, string>, body?: unknown } | undefined }}
 */
export function installSheetsGrid(required) {
  const { fake, spreadsheetId, token } = required;
  const tabs = required.tabs.map((tab) => ({
    sheetId: tab.sheetId, title: tab.title, rowCount: tab.rowCount ?? 1000, columnCount: tab.columnCount ?? 26,
    rows: new Map(Object.entries(tab.rows ?? {}).map(([row, cells]) => [Number(row), [...cells]])),
  }));
  // Column markers: { sheetId, key, value, index } (what createDeveloperMetadata stores on a column).
  const metadata = required.tabs.flatMap((tab) => Object.entries(tab.markers ?? {}).map(([value, index]) => ({ sheetId: tab.sheetId, key: 'tovu_form_field', value, index })));
  const grid = {
    failNext: undefined,
    tab: (sheetId) => tabs.find((tab) => tab.sheetId === sheetId),
    /** Non-empty rows in order, trailing blanks trimmed. */
    metadata,
    /** field id → column index of the markers on one tab. */
    markersOf: (sheetId) => Object.fromEntries(metadata.filter((entry) => entry.sheetId === sheetId).map((entry) => [entry.value, entry.index])),
    rowsOf: (sheetId) => [...grid.tab(sheetId).rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => trimRow(row)).filter((row) => row.length > 0),
  };
  const prefix = `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const byTitle = (title) => tabs.find((tab) => tab.title === title);

  function readValues(tab, range) {
    const last = Math.min(range.r2 ?? tab.rowCount, tab.rowCount);
    const values = [];
    for (let row = range.r1; row <= last; row += 1) {
      const cells = tab.rows.get(row) ?? [];
      values.push(trimRow(cells.slice(range.c1, range.c2 === undefined ? undefined : range.c2 + 1)));
    }
    while (values.length > 0 && values.at(-1).length === 0) values.pop();
    return values;
  }

  function writeRow(tab, rowNumber, column, cells) {
    const row = tab.rows.get(rowNumber) ?? [];
    cells.forEach((value, offset) => { row[column + offset] = value; });
    tab.rows.set(rowNumber, row);
  }

  function append(tab, values) {
    const lastRow = Math.max(0, ...[...tab.rows.entries()].filter(([, row]) => trimRow(row).length > 0).map(([n]) => n));
    const target = lastRow + 1;
    // INSERT_ROWS: the grid grows by the inserted rows.
    tab.rowCount += values.length;
    values.forEach((cells, offset) => writeRow(tab, target + offset, 0, cells));
    const width = Math.max(...values.map((cells) => cells.length));
    return { updates: { updatedRange: `'${tab.title}'!A${target}:${columnLetters(width - 1)}${target + values.length - 1}`, updatedRows: values.length } };
  }

  const BATCH = {
    appendDimension: ({ sheetId, length }) => { grid.tab(sheetId).columnCount += length; },
    updateCells: ({ start, rows, fields }) => {
      if (fields !== 'userEnteredValue' || start.rowIndex !== 0) throw new Error('fake grid: only row-1 text cells');
      const tab = grid.tab(start.sheetId);
      if (start.columnIndex + rows[0].values.length > tab.columnCount) throw new Error('fake grid: past the last column');
      writeRow(tab, 1, start.columnIndex, rows[0].values.map((cell) => cell.userEnteredValue.stringValue));
    },
    createDeveloperMetadata: ({ developerMetadata: { metadataKey, metadataValue, location: { dimensionRange } } }) => {
      metadata.push({ sheetId: dimensionRange.sheetId, key: metadataKey, value: metadataValue, index: dimensionRange.startIndex });
    },
  };

  /** Applies every request, or none (Google's batchUpdate is atomic). */
  function batchUpdate(body) {
    const before = { tabs: structuredClone(tabs.map((tab) => ({ columnCount: tab.columnCount, rows: [...tab.rows] }))), metadata: metadata.length };
    try {
      for (const request of body.requests) {
        const [[kind, value]] = Object.entries(request);
        BATCH[kind](value);
      }
      return [200, {}];
    } catch {
      tabs.forEach((tab, index) => { tab.columnCount = before.tabs[index].columnCount; tab.rows = new Map(before.tabs[index].rows); });
      metadata.length = before.metadata;
      return [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }];
    }
  }

  function searchMetadata(body) {
    const lookup = JSON.parse(body).dataFilters[0].developerMetadataLookup;
    const matched = metadata.filter((entry) => entry.key === lookup.metadataKey && entry.sheetId === lookup.metadataLocation.sheetId);
    return { matchedDeveloperMetadata: matched.map((entry) => ({ developerMetadata: { metadataKey: entry.key, metadataValue: entry.value, location: { locationType: 'COLUMN', dimensionRange: { sheetId: entry.sheetId, dimension: entry.dimension ?? 'COLUMNS', startIndex: entry.index, endIndex: entry.index + 1 } } } })) };
  }

  function values(req, body, url) {
    const [encoded, method] = url.pathname.slice(`${prefix}/values/`.length).split(':');
    const range = parseRange(decodeURIComponent(encoded));
    const tab = range && byTitle(range.title);
    if (!tab) return [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }];
    if (req.method === 'GET') return [200, { range: decodeURIComponent(encoded), majorDimension: 'ROWS', values: readValues(tab, range) }];
    const payload = JSON.parse(body);
    if (method === 'append') return [200, append(tab, payload.values)];
    if (range.c1 + payload.values[0].length > tab.columnCount) return [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }];
    writeRow(tab, range.r1, range.c1, payload.values[0]);
    return [200, { updatedRange: decodeURIComponent(encoded) }];
  }

  function handle(req, body, url) {
    if (req.headers.authorization !== `Bearer ${token}`) return [401, { error: { code: 401, status: 'UNAUTHENTICATED' } }];
    if (grid.failNext) {
      const failure = grid.failNext;
      grid.failNext = undefined;
      return [failure.status, failure.body ?? { error: { code: failure.status } }, failure.headers];
    }
    if (url.pathname === prefix && req.method === 'GET') {
      // The spreadsheet's id and title too (a `fields` mask is not applied), so a panel can verify it before saving.
      return [200, { spreadsheetId, properties: { title: 'Leads' }, sheets: tabs.map((tab) => ({ properties: { sheetId: tab.sheetId, title: tab.title, gridProperties: { rowCount: tab.rowCount, columnCount: tab.columnCount } } })) }];
    }
    if (url.pathname === `${prefix}:batchUpdate`) return batchUpdate(JSON.parse(body));
    if (url.pathname === `${prefix}/developerMetadata:search`) return [200, searchMetadata(body)];
    return values(req, body, url);
  }

  for (const method of ['GET', 'PUT', 'POST']) fake.routePrefix({ method, prefix }, handle);
  return grid;
}
