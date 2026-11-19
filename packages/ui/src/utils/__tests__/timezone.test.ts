import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocalTimezone, listSupportedTimezones, tzCityLabel } from '../timezone.js';

type IntlWithSupportedValuesOf = { supportedValuesOf?: ((key: string) => string[]) | undefined };

function asIntlWithSupportedValuesOf(): IntlWithSupportedValuesOf {
  return Intl as unknown as IntlWithSupportedValuesOf;
}

describe('detectLocalTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the resolved Intl timezone', () => {
    expect(detectLocalTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('falls back to UTC when Intl.DateTimeFormat throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(detectLocalTimezone()).toBe('UTC');
  });

  it('falls back to UTC when resolvedOptions().timeZone is empty', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as unknown as Intl.DateTimeFormat,
    );
    expect(detectLocalTimezone()).toBe('UTC');
  });
});

describe('listSupportedTimezones', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a non-empty list including UTC on a runtime that supports supportedValuesOf', () => {
    const list = listSupportedTimezones();
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('UTC');
  });

  it('adds UTC when the runtime list omits it', () => {
    const intl = asIntlWithSupportedValuesOf();
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = () => ['Asia/Tokyo', 'Europe/London'];
    try {
      const list = listSupportedTimezones();
      expect(list[0]).toBe('UTC');
      expect(list).toContain('Asia/Tokyo');
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('returns the runtime list unchanged when it already includes UTC', () => {
    const intl = asIntlWithSupportedValuesOf();
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = () => ['UTC', 'Asia/Tokyo'];
    try {
      expect(listSupportedTimezones()).toEqual(['UTC', 'Asia/Tokyo']);
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('falls back to the static list when supportedValuesOf is missing', () => {
    const intl = asIntlWithSupportedValuesOf();
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = undefined;
    try {
      const list = listSupportedTimezones();
      expect(list).toContain('UTC');
      expect(list).toContain('America/Los_Angeles');
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('falls back to the static list when supportedValuesOf throws', () => {
    const intl = asIntlWithSupportedValuesOf();
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = () => {
      throw new Error('boom');
    };
    try {
      const list = listSupportedTimezones();
      expect(list).toContain('UTC');
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('falls back to the static list when supportedValuesOf returns an empty array', () => {
    const intl = asIntlWithSupportedValuesOf();
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = () => [];
    try {
      const list = listSupportedTimezones();
      expect(list).toContain('UTC');
      expect(list).toContain('America/Los_Angeles');
    } finally {
      intl.supportedValuesOf = original;
    }
  });
});

describe('tzCityLabel', () => {
  it('returns UTC unchanged', () => {
    expect(tzCityLabel({ timezone: 'UTC' })).toBe('UTC');
  });

  it('takes the last path segment and replaces underscores with spaces', () => {
    expect(tzCityLabel({ timezone: 'America/Los_Angeles' })).toBe('Los Angeles');
    expect(tzCityLabel({ timezone: 'Asia/Tokyo' })).toBe('Tokyo');
  });

  it('returns the whole string when there is no slash', () => {
    expect(tzCityLabel({ timezone: 'Zulu' })).toBe('Zulu');
  });
});
