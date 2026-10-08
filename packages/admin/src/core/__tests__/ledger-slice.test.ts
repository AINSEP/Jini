import { describe, expect, it } from 'vitest';
import { loadNamespaceValues, saveChangedEntries, readNumber } from '../ledger-slice.js';
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
});
