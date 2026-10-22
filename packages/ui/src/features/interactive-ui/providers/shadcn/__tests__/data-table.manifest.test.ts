import { describe, expect, it } from 'vitest';
import { shadcnDataTableManifest, shadcnDataTablePropsSchema } from '../data-table.manifest.js';

describe('shadcnDataTableManifest', () => {
  it('shares data-table capabilities with the native provider, for fallback-chain resolution', () => {
    expect(shadcnDataTableManifest.capabilities).toContain('data-table');
    expect(shadcnDataTableManifest.provider).toBe('shadcn');
  });

  it('accepts a well-formed columns/rows payload', () => {
    const result = shadcnDataTablePropsSchema.safeParse({
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'Ada' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing columns', () => {
    const result = shadcnDataTablePropsSchema.safeParse({ rows: [] });
    expect(result.success).toBe(false);
  });

  it('accepts optional local sorting and paging without dropping A2UI actions', () => {
    const payload = {
      columns: [{ key: 'name', label: 'Name' }], rows: [], sortable: false, pageSize: 10,
      action: { event: { name: 'rowClicked' } },
    };
    expect(shadcnDataTablePropsSchema.parse(payload)).toEqual(payload);
  });

  it('rejects invalid page sizes', () => {
    for (const pageSize of [0, -1, 1.5, 101]) {
      expect(shadcnDataTablePropsSchema.safeParse({ columns: [{ key: 'name', label: 'Name' }], rows: [], pageSize }).success).toBe(false);
    }
  });
});
