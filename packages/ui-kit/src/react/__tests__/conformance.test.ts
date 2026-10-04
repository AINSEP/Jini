import { describe, it, expect, beforeAll } from 'vitest';
import { createKit } from '../kit.js';
import { runKitConformance } from '../testing/index.js';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
describe('native kit conformance', () => {
  it('passes every non-browser case, with every implemented component represented', async () => {
    const results = await runKitConformance({ kit: createKit({}) });
    expect(results.filter(result => result.status === 'failed')).toEqual([]);
    expect(results.filter(result => result.status === 'passed')).toHaveLength(21);
    expect(results.filter(result => result.status === 'skipped').map(result => result.id)).toEqual(['ConfirmDialog:browser-escape', 'ConfirmDialog:browser-modal-focus']);
  });
  it('refuses to label synthetic key events as a browser result', async () => {
    await expect(runKitConformance({ kit: createKit({}) }, { includeBrowser: true })).rejects.toThrow('real browser driver');
  });
});
