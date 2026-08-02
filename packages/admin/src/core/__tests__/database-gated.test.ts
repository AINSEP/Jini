import { describe, expectTypeOf, it } from 'vitest';
import type { AdminDatabasePort, MigrateForwardResult } from '../ports/database.js';
import type { GatedOperation } from '../gated/types.js';

/**
 * `database.ts`'s header claims `AdminDatabasePort['migrateForward']` is the simple case of
 * `GatedOperation` — `confirm`/`execute` take only the default bare-string token, no
 * operation-specific extra fields. `recovery.ts`'s restore triad is the parameterized case (see
 * `recovery-gated.test.ts` and that file's header) — both are pinned so a regression in either
 * shape is caught here. This is a compile-time-only assertion — `expectTypeOf` performs no runtime
 * work, so a regression here is caught by `tsc` (the `typecheck` script), not by `vitest run`
 * alone.
 */
describe('AdminDatabasePort.migrateForward', () => {
  it('structurally satisfies GatedOperation<void, unknown, MigrateForwardResult>', () => {
    expectTypeOf<AdminDatabasePort['migrateForward']>().toEqualTypeOf<
      GatedOperation<void, unknown, MigrateForwardResult>
    >();
  });
});
