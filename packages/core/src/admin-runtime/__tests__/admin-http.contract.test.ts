/**
 * @file F4.2 — `AdminApiError` must satisfy `AdminHttpError`, so a host can pass core's error class
 * as the client's error type. Checked by the compiler (`tsc` includes this file) and at runtime.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { AdminApiError } from '../index.js';
import type { AdminHttpError, AdminHttpOptions } from '../index.js';

describe('AdminHttpError contract', () => {
  it('AdminApiError is assignable to AdminHttpError', () => {
    expectTypeOf<AdminApiError>().toMatchTypeOf<AdminHttpError>();
    const error: AdminHttpError = new AdminApiError({ message: 'x', status: 409 }, { code: 'C', body: { a: 1 } });
    expect([error.status, error.code, error.body]).toEqual([409, 'C', { a: 1 }]);
  });

  it('an error without a numeric status is rejected', () => {
    // @ts-expect-error — `status` is required on every client error.
    const missing: AdminHttpError = new Error('no status');
    expect(missing).toBeInstanceOf(Error);
  });

  it('options narrow base paths and failure entries to the host vocabulary', () => {
    type Options = AdminHttpOptions<AdminApiError, '/api/a', 'page'>;
    expectTypeOf<Options['basePath']>().toEqualTypeOf<'/api/a' | undefined>();
    expectTypeOf<Options['failureEntry']>().toEqualTypeOf<'page' | undefined>();
  });
});
