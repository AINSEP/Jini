import { describe, expectTypeOf, it } from 'vitest';
import type { GatedOperation } from '../gated/types.js';
import type {
  AdminRecoveryPort,
  RestoreConfirmInput,
  RestoreExecuteInput,
  RestoreExecuteResult,
} from '../ports/recovery.js';

/**
 * The parameterized counterpart to `database-gated.test.ts`.
 *
 * Together the two pin both ends of `GatedOperation`: `migrateForward` uses the defaulted
 * `TConfirmInput`/`TExecuteInput` (bare tokens), restore supplies its own. Restore is the case that
 * matters most — it is the most destructive operation a host exposes, and an earlier draft of
 * `recovery.ts` declared it as three loose methods on the grounds that the shared interface could
 * not express it. It can. This assertion is what stops that regressing quietly.
 *
 * Compile-time only — `expectTypeOf` emits no runtime work, so a break here surfaces through `tsc`
 * (the `typecheck` script), not through `vitest run` alone.
 */
describe('AdminRecoveryPort.restore', () => {
  it('structurally satisfies GatedOperation with operation-specific confirm/execute input', () => {
    expectTypeOf<AdminRecoveryPort['restore']>().toEqualTypeOf<
      GatedOperation<string, unknown, RestoreExecuteResult, RestoreConfirmInput, RestoreExecuteInput>
    >();
  });

  it('requires the disclosure acknowledgement on confirm — the recorded-consent half', () => {
    expectTypeOf<RestoreConfirmInput>().toHaveProperty('disclosureAcknowledged');
    expectTypeOf<RestoreConfirmInput['disclosureAcknowledged']>().toEqualTypeOf<boolean>();
  });

  it('restates restorePointId on execute so the token cannot be replayed at another target', () => {
    expectTypeOf<RestoreExecuteInput>().toHaveProperty('restorePointId');
  });
});
