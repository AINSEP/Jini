import { describe, expect, it } from 'vitest';
import { nativeDataTableManifest, nativeDataTablePropsSchema } from '../data-table.manifest.js';

describe('nativeDataTableManifest', () => {
  it('advertises the table capabilities a search would match on', () => {
    expect(nativeDataTableManifest.capabilities).toContain('data-table');
    expect(nativeDataTableManifest.provider).toBe('native');
  });

  it('accepts a well-formed columns/rows payload', () => {
    const result = nativeDataTablePropsSchema.safeParse({
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'Ada' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing columns', () => {
    const result = nativeDataTablePropsSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
  });

  it('passes an unknown top-level key through rather than rejecting the whole payload — an A2UI action prop needs this', () => {
    const result = nativeDataTablePropsSchema.safeParse({
      columns: [{ key: 'name', label: 'Name' }],
      rows: [],
      action: { event: { name: 'rowClicked' } },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toEqual({ event: { name: 'rowClicked' } });
  });
});
