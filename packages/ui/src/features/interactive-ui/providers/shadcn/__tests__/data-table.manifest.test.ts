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
});
