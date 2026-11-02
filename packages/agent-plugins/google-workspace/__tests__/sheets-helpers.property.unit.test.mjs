/** Owner request 2026-10-20: bounded properties for the plugin-owned A1 and CSV helpers. */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import fc from 'fast-check';
import { columnIndex, columnName, parseA1Range, parseBoundsA1, tabRange } from '../lib/sheets-a1.mjs';
import { encodeCsv, MAX_EXPORT_CELLS, MAX_EXPORT_ROWS, planChunks } from '../lib/sheets-admin-csv.mjs';

const parameters = { numRuns: 150, seed: 20261023 };
const column = fc.integer({ min: 0, max: 18277 }); // A through ZZZ, the strict bounds parser's domain.
const title = fc.array(fc.constantFrom('a', ' ', "'", '!', 'é', '表', '😀'), { minLength: 1, maxLength: 30 }).map(parts => parts.join(''));

before(t => {
  t.diagnostic(`fast-check seed=${parameters.seed}, numRuns=${parameters.numRuns}`);
});

test('column names round-trip across one-, two-, and three-letter columns', () => {
  fc.assert(fc.property(column, index => {
    const name = columnName({ index });
    assert.match(name, /^[A-Z]{1,3}$/);
    assert.equal(columnIndex({ column: name }), index);
  }), parameters);
});

test('A1 bounds preserve both corners and quoted titles cannot change cell coordinates', () => {
  fc.assert(fc.property(column, column, fc.integer({ min: 1, max: 9999999 }), fc.integer({ min: 1, max: 9999999 }), title, (left, right, top, bottom, name) => {
    const [firstColumn, lastColumn] = [Math.min(left, right), Math.max(left, right)];
    const [firstRow, lastRow] = [Math.min(top, bottom) - 1, Math.max(top, bottom) - 1];
    const cells = `${columnName({ index: firstColumn })}${firstRow + 1}:${columnName({ index: lastColumn })}${lastRow + 1}`;
    assert.deepEqual(parseBoundsA1({ range: cells }), { firstColumn, lastColumn, firstRow, lastRow });
    const parsed = parseA1Range({ range: tabRange({ title: name, cells }) });
    assert.ok(parsed);
    assert.equal(parsed.sheet, `'${name.replaceAll("'", "''")}'`);
    assert.equal(columnIndex({ column: parsed.startColumn }), firstColumn);
    assert.equal(columnIndex({ column: parsed.endColumn }), lastColumn);
    assert.equal(parsed.startRow, firstRow + 1);
    assert.equal(parsed.endRow, lastRow + 1);
  }), parameters);
});

test('reversed corners and row zero are rejected instead of selecting a different area', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 9999998 }), row => {
    for (const range of [`A${row + 1}:A${row}`, `B${row}:A${row}`, `A0:B${row}`]) {
      assert.throws(() => parseBoundsA1({ range }), { code: 'invalid-input' });
    }
  }), parameters);
});

test('CSV read chunks cover the requested area exactly once within the cell budget', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 100 }), title,
    (columns, rows, firstRow, firstColumn, name) => {
      const area = { firstRow, lastRow: firstRow + rows - 1, firstColumn, lastColumn: firstColumn + columns - 1 };
      const chunks = planChunks({ title: name, area });
      assert.ok(chunks.length > 0);
      let nextRow = firstRow + 1;
      for (const chunk of chunks) {
        const parsed = parseA1Range({ range: chunk.range });
        assert.ok(parsed);
        assert.equal(parsed.startRow, nextRow);
        assert.equal(parsed.endRow - parsed.startRow + 1, chunk.rowCount);
        assert.equal(columnIndex({ column: parsed.startColumn }), firstColumn);
        assert.equal(columnIndex({ column: parsed.endColumn }), area.lastColumn);
        assert.ok(chunk.rowCount * columns <= 10000);
        nextRow = parsed.endRow + 1;
      }
      assert.equal(nextRow, area.lastRow + 2);
      assert.equal(chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0), rows);
    },
  ), parameters);
});

test('CSV planning refuses row and cell overflows before any reads', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), excess => {
    for (const area of [
      { firstRow: 0, lastRow: MAX_EXPORT_ROWS + excess - 1, firstColumn: 0, lastColumn: 0 },
      { firstRow: 0, lastRow: 0, firstColumn: 0, lastColumn: MAX_EXPORT_CELLS + excess - 1 },
    ]) assert.throws(() => planChunks({ title: 'Data', area }), { code: 'limit-exceeded' });
  }), parameters);
});

test('CSV text survives escaping and formula-like strings become inert', () => {
  const text = fc.array(fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom(',', '"', '\r', '\n', 'é', '表', '😀')), { maxLength: 12 }).map(parts => parts.join(''));
  fc.assert(fc.property(text, fc.constantFrom('', '=', '+', '-', '@', '\t', '\r'), (suffix, prefix) => {
    const value = `${prefix}${suffix}`;
    const result = encodeCsv({ rows: [[value]] });
    const decoded = result.csv.startsWith('"') ? result.csv.slice(1, -1).replaceAll('""', '"') : result.csv;
    if ([',', '"', '\r', '\n'].some(character => value.includes(character))) assert.match(result.csv, /^"(?:[^"]|"")*"$/);
    const triggers = new Set(['=', '+', '-', '@', '\t', '\r']);
    assert.equal(decoded, triggers.has(value[0]) ? `'${value}` : value);
    assert.equal(result.bytes, Buffer.byteLength(result.csv, 'utf8'));
    assert.equal(result.rows, 1);
    assert.equal(result.columns, 1);
  }), parameters);
});

test('numeric CSV values retain their type spelling, ragged rows are padded, empty tail rows are dropped', () => {
  fc.assert(fc.property(fc.array(fc.integer(), { minLength: 2, maxLength: 15 }), fc.integer({ min: 0, max: 5 }), (values, emptyTail) => {
    const result = encodeCsv({ rows: [values, [values[0]], ...Array.from({ length: emptyTail }, () => [])] });
    const rows = result.csv.split('\r\n');
    assert.deepEqual(rows[0].split(','), values.map(String));
    assert.deepEqual(rows[1].split(','), [String(values[0]), ...Array(values.length - 1).fill('')]);
    assert.equal(result.rows, 2);
    assert.equal(result.columns, values.length);
    assert.equal(result.bytes, Buffer.byteLength(result.csv));
  }), parameters);
});
