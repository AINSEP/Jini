import { describe, expect, it, vi } from 'vitest';
import type { AdminEntityDescriptor, AdminErasedEntityPort } from '../../../core/ports/entities.js';
import { fromDatetimeLocalValue, loadRelationIndex, resolveEntityPageSize, toDatetimeLocalValue } from '../rules.js';

describe('relations', () => {
  it('loads one bounded page per distinct target and marks incomplete option sets using the cursor', async () => {
    const descriptor: AdminEntityDescriptor = {
      name: 'item', labelSingular: 'Item', labelPlural: 'Items', titleField: 'title',
      fields: [
        { name: 'title', kind: 'text' },
        { name: 'ownerId', kind: 'relation', target: 'owner' },
        { name: 'reviewerId', kind: 'relation', target: 'owner' },
        { name: 'missingId', kind: 'relation', target: 'missing' },
      ],
    };
    const target: AdminErasedEntityPort = {
      descriptor: { ...descriptor, name: 'owner', fields: [{ name: 'title', kind: 'text' }] },
      list: vi.fn(async () => ({ items: [{ id: '__proto__', title: 'Owner' }], nextCursor: 'more' })),
      get: async () => null,
      create: async () => { throw new Error('unused'); },
      update: async () => { throw new Error('unused'); },
    };
    const result = await loadRelationIndex({ descriptor, registry: {
      listEntities: () => [target], getEntity: ({ name }) => name === 'owner' ? target : null,
    } });
    expect(target.list).toHaveBeenCalledTimes(1);
    expect(target.list).toHaveBeenCalledWith({ limit: 100 });
    expect(result.owner?.titles.__proto__).toBe('Owner');
    expect(result.owner?.truncated).toBe(true);
    expect(result).not.toHaveProperty('missing');
  });
});

describe('page sizes', () => {
  it('bounds URL-supplied limits and rejects incomplete or fractional numbers', () => {
    for (const raw of [null, '', '0', '-1', '2x', '1.5', 'Infinity']) expect(resolveEntityPageSize({ raw })).toBe(25);
    expect(resolveEntityPageSize({ raw: '2' })).toBe(2);
    expect(resolveEntityPageSize({ raw: '99999' })).toBe(200);
  });
});

it('preserves nonzero milliseconds in a datetime control round trip', () => {
  const value = '2026-01-15T10:30:45.123Z';
  const raw = toDatetimeLocalValue({ value });
  expect(raw).toBe('2026-01-15T10:30:45.123');
  expect(fromDatetimeLocalValue({ raw })).toBe(value);
});
