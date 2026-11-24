import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  assertVersionedWrite,
  fromSettingsRevisionConflict,
  parseExpectedVersion,
  RecordVersionConflictError,
  RecordVersionRequiredError,
  type SaveConflict,
  requireEditorVersion,
  requireExpectedVersion,
  VERSION_CONFLICT_CODE,
  versionConflictBody,
  versionConflictRule,
  VERSION_REQUIRED_CODE,
  versionRequiredBody,
} from '../optimistic-concurrency.js';
import { ToolInputError } from '../tool-input-errors.js';
import { SettingsRevisionConflictError } from '../settings/errors.js';

const conflict = (currentVersion: number | null) =>
  new RecordVersionConflictError({ recordKind: 'webhook', recordId: 'wh_1', expectedVersion: 3, currentVersion });

describe('RecordVersionConflictError', () => {
  it('says in plain words that nothing was saved and what to do', () => {
    const error = conflict(4);
    expect(error.message).toBe(
      'This webhook was changed by someone else after you opened it (you had version 3, it is now version 4). ' +
        'Nothing was saved. Reload it to see the latest version, then make your change again.',
    );
    expect(error.code).toBe(VERSION_CONFLICT_CODE);
    expect(error.name).toBe('RecordVersionConflictError');
  });

  it('names a deleted record as deleted', () => {
    expect(conflict(null).message).toContain('it has since been deleted');
  });
});

describe('parseExpectedVersion', () => {
  it('treats an absent basis as not sent', () => {
    expect(parseExpectedVersion({ value: undefined })).toBeUndefined();
  });

  it('accepts a non-negative integer', () => {
    expect(parseExpectedVersion({ value: 0 })).toBe(0);
    expect(parseExpectedVersion({ value: 7 })).toBe(7);
  });

  it.each([['3'], [3.5], [-1], [null], [true], [Number.MAX_SAFE_INTEGER + 2]])('refuses %p instead of treating it as no basis', (value) => {
    expect(() => parseExpectedVersion({ value })).toThrow(ToolInputError);
  });

  it('names the caller field in the refusal', () => {
    expect(() => parseExpectedVersion({ value: 'x' }, { field: 'expectedRevisionSeq' })).toThrow(
      "'expectedRevisionSeq' must be a non-negative integer when present",
    );
  });
});

describe('requireExpectedVersion', () => {
  it('returns a present basis', () => {
    expect(requireExpectedVersion({ value: 2, readToolId: 'webhooks_get' })).toBe(2);
  });

  it('tells the model which read tool supplies a missing basis', () => {
    expect(() => requireExpectedVersion({ value: undefined, readToolId: 'webhooks_get' })).toThrow(
      "'expectedVersion' is required: call webhooks_get first and pass the record's current version.",
    );
  });
});

describe('assertVersionedWrite', () => {
  it('passes when the conditional write changed a row, without reading', async () => {
    let reads = 0;
    await assertVersionedWrite({
      changedRows: 1n, recordKind: 'webhook', recordId: 'wh_1', expectedVersion: 3,
      readCurrentVersion: async () => { reads += 1; return 3; },
    });
    expect(reads).toBe(0);
  });

  it('throws a conflict carrying the live version when no row changed', async () => {
    const attempt = assertVersionedWrite({
      changedRows: 0, recordKind: 'webhook', recordId: 'wh_1', expectedVersion: 3, readCurrentVersion: async () => 5,
    });
    await expect(attempt).rejects.toMatchObject({ expectedVersion: 3, currentVersion: 5, recordId: 'wh_1' });
    await expect(attempt).rejects.toBeInstanceOf(RecordVersionConflictError);
  });
});

describe('versionConflictBody', () => {
  it('builds the 409 body with structured versions', () => {
    expect(versionConflictBody({ error: conflict(4) })).toEqual({
      error: conflict(4).message,
      code: 'VERSION_CONFLICT',
      details: { recordKind: 'webhook', recordId: 'wh_1', expectedVersion: 3, currentVersion: 4 },
    });
  });
});

describe('versionConflictRule', () => {
  it('matches the error class and tells the model to re-read with the named tool', () => {
    const rule = versionConflictRule({ readToolId: 'webhooks_get' });
    expect(rule.error).toBe(RecordVersionConflictError);
    expect(rule.code).toBe('VERSION_CONFLICT');
    expect(rule.guidance).toContain('Call webhooks_get again');
    expect(rule.guidance).toContain('NOT applied');
  });
});

describe('fromSettingsRevisionConflict', () => {
  it('turns a settings ledger conflict into the shared conflict, keeping the cause', () => {
    const cause = new SettingsRevisionConflictError({ expectedRevisionSeq: 2, actualRevisionSeq: 5 });
    const error = fromSettingsRevisionConflict({ error: cause, setting: 'site.seo.title' });
    expect(error).toBeInstanceOf(RecordVersionConflictError);
    expect(error).toMatchObject({ recordKind: 'setting', recordId: 'site.seo.title', expectedVersion: 2, currentVersion: 5, cause });
  });

  it('returns any other error unchanged', () => {
    const other = new Error('disk full');
    expect(fromSettingsRevisionConflict({ error: other, setting: 'site.seo.title' })).toBe(other);
  });
});

describe('requireEditorVersion', () => {
  it('refuses a save that names no version', () => {
    expect(() => requireEditorVersion({ value: undefined })).toThrow(RecordVersionRequiredError);
  });

  it('keeps a malformed version a ToolInputError', () => {
    expect(() => requireEditorVersion({ value: '3' })).toThrow(ToolInputError);
  });

  it('returns a valid version', () => {
    expect(requireEditorVersion({ value: 3 })).toBe(3);
  });

  it('answers 428 with the full envelope', () => {
    const error = new RecordVersionRequiredError({ field: 'version' });
    expect(versionRequiredBody({ error })).toEqual({ error: error.message, code: VERSION_REQUIRED_CODE, details: { field: 'version' } });
  });
});

describe('SaveConflict', () => {
  it('pins the three-field shape an editor reads back from a lost compare-and-set', () => {
    expectTypeOf<SaveConflict>().toEqualTypeOf<{
      expectedVersion: number | null;
      currentVersion: number | null;
      attemptedStatus: 'draft' | 'published' | undefined;
    }>();
    expectTypeOf<SaveConflict['attemptedStatus']>().toEqualTypeOf<'draft' | 'published' | undefined>();
    const saved: SaveConflict = { expectedVersion: 3, currentVersion: null, attemptedStatus: 'published' };
    expect(Object.keys(saved).sort()).toEqual(['attemptedStatus', 'currentVersion', 'expectedVersion']);
  });
});
