import { describe, expect, it } from 'vitest';
import { loadNamespaceValues, saveChangedEntries, readBoolean, readNumber, readString } from '../ledger-slice.js';
import type { AdminSettingsPort } from '../ports/settings.js';

describe('shared settings ledger contracts', () => {
  it('defaults only for the host-classified unregistered namespace', async () => {
    const missing = new Error('unregistered');
    const failed = new Error('network unavailable');
    let error = missing;
    const port: Pick<AdminSettingsPort, 'getSettingsEffective'> = {
      getSettingsEffective: async () => { throw error; },
    };
    const options = { isUnregisteredNamespace: ({ error: caught }: { error: unknown }) => caught === missing };
    expect(await loadNamespaceValues({ namespace: 'preferences', port }, options)).toEqual(new Map());
    error = failed;
    await expect(loadNamespaceValues({ namespace: 'preferences', port }, options)).rejects.toBe(failed);
  });

  it('waits for the first changed key before starting the next and skips unchanged candidates', async () => {
    const keys: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const port: Pick<AdminSettingsPort, 'setSetting'> = {
      setSetting: async ({ key, scope, value }) => {
        keys.push(key);
        if (key === 'first') await pending;
        return { key, scope, value, revisionSeq: 1 };
      },
    };
    const saved = saveChangedEntries({ namespace: 'preferences', scope: 'workspace', port, candidates: [
      { key: 'first', valueJson: 1, changed: true },
      { key: 'unchanged', valueJson: 2, changed: false },
      { key: 'second', valueJson: 3, changed: true },
    ] }, {});
    expect(keys).toEqual(['first']);
    release();
    expect(await saved).toEqual(['first', 'second']);
    expect(keys).toEqual(['first', 'second']);
    expect(readNumber({ values: new Map([['invalid', Infinity]]), key: 'invalid', fallback: 5 }, {})).toBe(5);
  });

  it('maps every effective row of a registered namespace by key', async () => {
    const asked: string[] = [];
    const port: Pick<AdminSettingsPort, 'getSettingsEffective'> = {
      getSettingsEffective: async ({ namespace }) => { asked.push(namespace); return [{ key: 'title', value: 'Site', sourceLayer: 'workspace', defVersion: 1 }, { key: 'enabled', value: true, sourceLayer: 'default', defVersion: 1 }]; },
    };
    const values = await loadNamespaceValues({ namespace: 'appearance', port }, { isUnregisteredNamespace: () => true });
    expect([...values]).toEqual([['title', 'Site'], ['enabled', true]]);
    expect(asked).toEqual(['appearance']);
  });

  it('reads typed values field by field and falls back on absent or wrong-typed keys', () => {
    const values = new Map<string, unknown>([['title', 'Site'], ['enabled', false], ['count', 3], ['wrong', 1]]);
    expect(readString({ values, key: 'title', fallback: 'x' })).toBe('Site');
    expect(readString({ values, key: 'wrong', fallback: 'x' })).toBe('x');
    expect(readString({ values, key: 'absent', fallback: 'x' })).toBe('x');
    expect(readBoolean({ values, key: 'enabled', fallback: true })).toBe(false);
    expect(readBoolean({ values, key: 'title', fallback: true })).toBe(true);
    expect(readNumber({ values, key: 'count', fallback: 0 })).toBe(3);
    expect(readNumber({ values, key: 'title', fallback: 0 })).toBe(0);
  });
});
