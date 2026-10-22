import { describe, expect, it } from 'vitest';
import { createDictionaryTranslator, interpolate, pickPlural, splitOnPlaceholders } from '../../../i18n/index.js';
import { formatTimestamp, formatRelativeMinutesAgo } from '../format-timestamp.js';
import { hasPermission } from '../permissions.js';
import { resolveActiveTabId } from '../resolve-active-tab-id.js';
import { retryWhileUnreachable } from '../retry-unreachable.js';

describe('integrated object argument API', () => {
  it('retains feature/common/fallback dictionary precedence', () => {
    const translate = createDictionaryTranslator({ featureDictionary: { es: { Save: 'Guardar todo' } } }, { commonDictionary: { es: { Save: 'Guardar', Close: 'Cerrar' } } });
    expect(translate({ locale: 'es', key: 'Save' })).toBe('Guardar todo');
    expect(translate({ locale: 'es', key: 'Close' })).toBe('Cerrar');
    expect(translate({ locale: 'es', key: 'unknown' })).toBe('unknown');
  });
  it('retains formatting, permission and selection contracts', () => {
    expect(interpolate({ template: '{name}: {count}', vars: { name: 'Rows', count: 2 } })).toBe('Rows: 2');
    expect(splitOnPlaceholders({ template: 'a{x}b{y}c', tokens: ['{x}', '{y}'] })).toEqual(['a', 'b', 'c']);
    expect(pickPlural({ count: 0, forms: { one: 'row', other: 'rows' } })).toBe('rows');
    expect(formatTimestamp({ iso: '2026-10-01T12:34:56Z' })).toBe('2026-10-01 12:34');
    expect(formatRelativeMinutesAgo({ iso: '2026-10-01T12:30:00Z', nowMs: Date.parse('2026-10-01T12:32:00Z') }, { translate: () => '{minutes} minutos' })).toBe('2 minutos');
    expect(hasPermission({ permissions: ['*'], permission: 'edit' })).toBe(true);
    expect(hasPermission({ permissions: [], permission: 'edit' })).toBe(false);
    expect(resolveActiveTabId({ tabId: 'unknown', validIds: ['first', 'second'], defaultId: 'second' })).toBe('second');
  });
  it('uses the injected wait port and never retries an unrelated error', async () => {
    const waits: number[] = [];
    let attempt = 0;
    const signal = new AbortController().signal;
    const result = await retryWhileUnreachable({ load: async () => { if (++attempt < 3) throw new Error('offline'); return 'ok'; }, signal, isUnreachable: error => error instanceof Error && error.message === 'offline' }, { delaysMs: [1, 2], wait: async ({ ms }) => { waits.push(ms); } });
    expect(result).toBe('ok');
    expect(waits).toEqual([1, 2]);
    const failure = new Error('denied');
    await expect(retryWhileUnreachable({ load: async () => { throw failure; }, signal, isUnreachable: () => false }, { wait: async () => { throw new Error('unexpected wait'); } })).rejects.toBe(failure);
  });
});
