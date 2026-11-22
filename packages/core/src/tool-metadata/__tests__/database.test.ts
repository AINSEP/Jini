import { describe, expect, it } from 'vitest';
import { toolMetadata } from '../database.js';

/** The destructive forward migration must stay a plan-confirmed delete, never a direct edit. */
describe('database tool metadata', () => {
  it('pins database_execute_migrate_forward to a plan-confirmed delete', () => {
    const migrate = toolMetadata.database_execute_migrate_forward;
    expect(migrate.approval).toEqual({ class: 'delete', confirmation: 'plan' });
    expect(migrate.title).toBe('Apply database changes');
    expect(migrate.summary).toBe('This applies the planned database changes and may permanently change stored data.');
  });
});
