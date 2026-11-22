import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'vitest';
import { DATABASE_COPY_RETENTION, selectDatabaseCopiesToPrune, type DatabaseCopy } from '../../sqlite/backup-policy.js';

const dir = path.resolve('/site/ops');
const copy = (index: number, folder = dir): DatabaseCopy => ({ filePath: path.join(folder, `copy-${String(index).padStart(2, '0')}.db`), createdAt: index * 1000 });
/** Eight copies in one folder; copy-08 is the newest. */
const eight = Array.from({ length: 8 }, (_, i) => copy(i + 1));
const names = (copies: readonly DatabaseCopy[]) => copies.map(entry => path.basename(entry.filePath));

test('default keeps 5', () => {
  assert.equal(DATABASE_COPY_RETENTION, 5);
  const selected = selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: copy(8).filePath });
  assert.deepEqual(names(selected), ['copy-03.db', 'copy-02.db', 'copy-01.db']);
});

test('a caller-supplied keep widens or narrows the newest window', () => {
  assert.deepEqual(names(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: copy(8).filePath }, { keep: 7 })), ['copy-01.db']);
  assert.deepEqual(names(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: copy(8).filePath }, { keep: 1 })).length, 7);
});

test('protected paths are kept beyond the cap', () => {
  const selected = selectDatabaseCopiesToPrune(
    { copies: eight, verifiedNewest: copy(8).filePath },
    { protectedPaths: new Set([copy(1).filePath, copy(2).filePath]) },
  );
  assert.deepEqual(names(selected), ['copy-03.db']);
});

test('nothing is selected without a verified newest copy', () => {
  assert.deepEqual(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: null }), []);
  assert.deepEqual(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: undefined }), []);
});

test('a verified copy that is not the newest local copy selects nothing', () => {
  // A newer, unverified copy appeared after verification: the anchor no longer proves the window.
  assert.deepEqual(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: copy(7).filePath }), []);
  // The anchor must be one of the listed copies, not an arbitrary path.
  assert.deepEqual(selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: path.join(dir, 'elsewhere.db') }), []);
});

test('copies from another directory are ignored', () => {
  const foreign = Array.from({ length: 8 }, (_, i) => copy(i + 1, path.resolve('/other/ops')));
  const selected = selectDatabaseCopiesToPrune({ copies: [...foreign, ...eight], verifiedNewest: copy(8).filePath });
  assert.deepEqual(selected.map(entry => entry.filePath), [copy(3), copy(2), copy(1)].map(entry => entry.filePath));
});

test('equal timestamps fall back to the same name order the live pruner uses', () => {
  const tied = [
    { filePath: path.join(dir, 'a.db'), createdAt: 1 },
    { filePath: path.join(dir, 'b.db'), createdAt: 1 },
    { filePath: path.join(dir, 'c.db'), createdAt: 2 },
  ];
  assert.deepEqual(names(selectDatabaseCopiesToPrune({ copies: tied, verifiedNewest: path.join(dir, 'c.db') }, { keep: 2 })), ['a.db']);
});

test('selection is pure: the input list is not reordered or changed', () => {
  const input = [...eight].reverse();
  const before = JSON.stringify(input);
  selectDatabaseCopiesToPrune({ copies: input, verifiedNewest: copy(8).filePath });
  assert.equal(JSON.stringify(input), before);
});

test('keep below 1 or not a whole number is refused in plain words', () => {
  for (const keep of [0, -1, 2.5, Number.NaN]) {
    assert.throws(
      () => selectDatabaseCopiesToPrune({ copies: eight, verifiedNewest: copy(8).filePath }, { keep }),
      { name: 'RangeError', message: /keep must be a whole number of at least 1/ },
    );
  }
});
