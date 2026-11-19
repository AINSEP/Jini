import { describe, expect, it } from 'vitest';
import { collectProcessTreePids } from '../process.js';

const snap = (pid: number, ppid: number) => ({ pid, ppid, command: `c${pid}` });

describe('collectProcessTreePids', () => {
  it('collects descendants, sorted descending', () => {
    expect(collectProcessTreePids({ processes: [snap(2, 1), snap(3, 2), snap(4, 1), snap(9, 8)], rootPids: [1] })).toEqual([4, 3, 2, 1]);
  });
  it('survives cycles', () => {
    expect(collectProcessTreePids({ processes: [snap(1, 2), snap(2, 1)], rootPids: [1] })).toEqual([2, 1]);
  });
  it('keeps unknown roots and ignores null/undefined roots', () => {
    expect(collectProcessTreePids({ processes: [snap(2, 1)], rootPids: [77, null, undefined] })).toEqual([77]);
  });
});
