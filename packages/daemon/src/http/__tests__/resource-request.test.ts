import { describe, expect, it, vi } from 'vitest';
import {
  isRecord,
  readOptionalNonEmptyString,
  readOptionalNumber,
  resolveResourceRoot,
  withoutUndefined,
} from '../resource-request.js';
import { denyAllWorkspaceRoots, type WorkspaceRootResolver } from '../workspace-root.js';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it.each([[null], [[]], ['x'], [1], [undefined]])('rejects %j', (value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe('withoutUndefined', () => {
  it('drops undefined-valued keys and keeps the rest in order, including falsy values', () => {
    const result = withoutUndefined({ a: undefined, b: 0, c: '', d: null, e: false, f: undefined });
    expect(result).toEqual({ b: 0, c: '', d: null, e: false });
    expect(Object.keys(result)).toEqual(['b', 'c', 'd', 'e']);
  });
});

describe('readOptionalNonEmptyString', () => {
  it('returns undefined for an absent field', () => {
    expect(readOptionalNonEmptyString({ body: {}, field: 'detail' })).toEqual({ ok: true, value: undefined });
  });

  it('returns a present non-empty string', () => {
    expect(readOptionalNonEmptyString({ body: { detail: 'x' }, field: 'detail' })).toEqual({ ok: true, value: 'x' });
  });

  it.each([[''], [1], [null]])('refuses %j naming the field', (value) => {
    expect(readOptionalNonEmptyString({ body: { shell: value }, field: 'shell' })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'shell must be a non-empty string when provided' },
    });
  });
});

describe('readOptionalNumber', () => {
  it('returns undefined for an absent field', () => {
    expect(readOptionalNumber({ body: {}, field: 'cols' })).toEqual({ ok: true, value: undefined });
  });

  it('returns a present number', () => {
    expect(readOptionalNumber({ body: { cols: 80 }, field: 'cols' })).toEqual({ ok: true, value: 80 });
  });

  it.each([['80'], [null]])('refuses %j naming the field', (value) => {
    expect(readOptionalNumber({ body: { rows: value }, field: 'rows' })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'rows must be a number when provided' },
    });
  });
});

describe('resolveResourceRoot', () => {
  it('returns the resolved directory and forwards detail when given', async () => {
    const resolver = vi.fn<WorkspaceRootResolver>(() => '/work');
    expect(await resolveResourceRoot({ resourceRef: 'r1', detail: 'd' }, { resolver })).toEqual({ ok: true, value: '/work' });
    expect(resolver).toHaveBeenCalledWith({ request: { resourceRef: 'r1', detail: 'd' } });
  });

  it('omits the detail key entirely when detail is undefined', async () => {
    const resolver = vi.fn<WorkspaceRootResolver>(() => '/work');
    await resolveResourceRoot({ resourceRef: 'r1', detail: undefined }, { resolver });
    expect(Object.keys(resolver.mock.calls[0]![0].request)).toEqual(['resourceRef']);
  });

  it('maps a denial to NOT_FOUND naming the resource', async () => {
    expect(await resolveResourceRoot({ resourceRef: 'gone' }, { resolver: denyAllWorkspaceRoots })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'resource "gone" was not found' },
    });
  });

  it('rethrows a non-denial resolver failure unchanged', async () => {
    const failure = new Error('lookup backend unavailable');
    const resolver: WorkspaceRootResolver = () => {
      throw failure;
    };
    await expect(resolveResourceRoot({ resourceRef: 'r1' }, { resolver })).rejects.toBe(failure);
  });
});
