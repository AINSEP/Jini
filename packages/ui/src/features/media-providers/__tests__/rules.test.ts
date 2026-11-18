import { describe, expect, it } from 'vitest';

// Through the barrel — a symbol missing from `index.ts` fails here rather
// than at some host's build.
import {
  hasAnyConfiguredProvider,
  hasRecoverableFields,
  invalidBaseUrlProviderIds,
  isProviderBaseUrlInvalid,
  isEntryEmpty,
  isEntryPresent,
  isMarkerOnlyEntry,
  maskedKeyLabel,
  mergeDaemonProviders,
  resolveProviderBaseUrl,
  shouldSyncLocalProvidersToDaemon,
  sortProvidersByConfigured,
} from '../rules.js';
import type { MediaProviderMap } from '../types.js';

/**
 * The whole module turns on ONE distinction — real credential data
 * ("recoverable") vs. a server marker that proves a key exists without
 * carrying it. Most cases below exist to pin that boundary, because getting it
 * backwards silently either wipes an operator's typing or claims a provider is
 * configured after the server forgot it.
 */

describe('hasRecoverableFields', () => {
  it('is true for any real field', () => {
    expect(hasRecoverableFields({ entry: { apiKey: 'sk-1' } })).toBe(true);
    expect(hasRecoverableFields({ entry: { baseUrl: 'https://x' } })).toBe(true);
    expect(hasRecoverableFields({ entry: { model: 'm' } })).toBe(true);
  });

  it('is FALSE for markers only — they carry nothing re-sendable', () => {
    expect(hasRecoverableFields({ entry: { apiKeyConfigured: true } })).toBe(false);
    expect(hasRecoverableFields({ entry: { apiKeyTail: '1234' } })).toBe(false);
    expect(hasRecoverableFields({ entry: { apiKeyConfigured: true, apiKeyTail: '1234' } })).toBe(false);
  });

  it('treats whitespace-only values as absent', () => {
    expect(hasRecoverableFields({ entry: { apiKey: '   ', baseUrl: '\t', model: '\n' } })).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(hasRecoverableFields({ entry: null })).toBe(false);
    expect(hasRecoverableFields({ entry: undefined })).toBe(false);
    expect(hasRecoverableFields({ entry: {} })).toBe(false);
  });
});

describe('isEntryPresent / isEntryEmpty', () => {
  it('counts real data as present', () => {
    expect(isEntryPresent({ entry: { apiKey: 'sk-1' } })).toBe(true);
  });

  it('counts markers as present — a server-held key is still configured', () => {
    expect(isEntryPresent({ entry: { apiKeyConfigured: true } })).toBe(true);
    expect(isEntryPresent({ entry: { apiKeyTail: '1234' } })).toBe(true);
  });

  it('does not count apiKeyConfigured:false as present', () => {
    expect(isEntryPresent({ entry: { apiKeyConfigured: false } })).toBe(false);
  });

  it('does not count a whitespace-only tail as present', () => {
    expect(isEntryPresent({ entry: { apiKeyTail: '  ' } })).toBe(false);
  });

  it('is empty for nothing at all', () => {
    expect(isEntryPresent({ entry: {} })).toBe(false);
    expect(isEntryPresent({ entry: null })).toBe(false);
  });

  it('isEntryEmpty is the exact inverse', () => {
    for (const entry of [{ apiKey: 'k' }, { apiKeyConfigured: true }, {}, null]) {
      expect(isEntryEmpty({ entry })).toBe(!isEntryPresent({ entry }));
    }
  });
});

describe('isMarkerOnlyEntry', () => {
  it('is true for markers with no real data', () => {
    expect(isMarkerOnlyEntry({ entry: { apiKeyConfigured: true } })).toBe(true);
    expect(isMarkerOnlyEntry({ entry: { apiKeyTail: '1234' } })).toBe(true);
  });

  it('is false once any real field is present', () => {
    expect(isMarkerOnlyEntry({ entry: { apiKeyConfigured: true, apiKey: 'sk-1' } })).toBe(false);
    expect(isMarkerOnlyEntry({ entry: { apiKeyTail: '1234', baseUrl: 'https://x' } })).toBe(false);
  });

  it('is false for an entirely empty entry — nothing to be stale about', () => {
    expect(isMarkerOnlyEntry({ entry: {} })).toBe(false);
    expect(isMarkerOnlyEntry({ entry: null })).toBe(false);
  });
});

describe('hasAnyConfiguredProvider', () => {
  it('is true when at least one entry is present', () => {
    expect(hasAnyConfiguredProvider({ providers: { a: {}, b: { apiKey: 'k' } } })).toBe(true);
  });

  it('is false when every entry is empty', () => {
    expect(hasAnyConfiguredProvider({ providers: { a: {}, b: { apiKey: '  ' } } })).toBe(false);
  });

  it('is false for an empty map, null, or undefined', () => {
    expect(hasAnyConfiguredProvider({ providers: {} })).toBe(false);
    expect(hasAnyConfiguredProvider({ providers: null })).toBe(false);
    expect(hasAnyConfiguredProvider({ providers: undefined })).toBe(false);
  });
});

describe('mergeDaemonProviders', () => {
  it('returns local untouched when the server was never reached (null)', () => {
    // null means UNREACHABLE, not "server has nothing" — a network blip must
    // not wipe local edits. This is the case a `?? {}` default would break.
    const local: MediaProviderMap = { a: { apiKey: 'typed' }, b: { apiKeyConfigured: true } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: null })).toEqual(local);
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: undefined })).toEqual(local);
  });

  it('returns a COPY, not the same reference', () => {
    const local: MediaProviderMap = { a: { apiKey: 'typed' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: null })).not.toBe(local);
  });

  it('drops stale marker-only entries when the server manages nothing', () => {
    const local: MediaProviderMap = { stale: { apiKeyConfigured: true }, typed: { apiKey: 'sk-1' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: {} })).toEqual({ typed: { apiKey: 'sk-1' } });
  });

  it('keeps locally-typed entries when the server manages nothing', () => {
    // The operator typed these and no server has claimed them — dropping them
    // would discard unsaved work.
    const local: MediaProviderMap = { a: { baseUrl: 'https://local' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: { b: {} } })).toEqual(local);
  });

  it('lets a present server entry win over local', () => {
    const local: MediaProviderMap = { a: { apiKey: 'old', model: 'old-m' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '9999', apiKeyConfigured: true } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: daemon })).toEqual({ a: { apiKeyTail: '9999', apiKeyConfigured: true } });
  });

  it('skips a server entry that is not present, leaving local intact', () => {
    const local: MediaProviderMap = { a: { apiKey: 'keepme' } };
    const daemon: MediaProviderMap = { a: {}, b: { apiKeyConfigured: true } };
    const merged = mergeDaemonProviders({ localProviders: local, daemonProviders: daemon });
    expect(merged.a).toEqual({ apiKey: 'keepme' });
    expect(merged.b).toEqual({ apiKeyConfigured: true });
  });

  it('preserves a named local edit ON TOP of the server entry', () => {
    // Layering, not replacing: server-only markers must survive alongside the
    // in-progress edit.
    const local: MediaProviderMap = { a: { apiKey: 'being-typed' } };
    const daemon: MediaProviderMap = { a: { apiKeyConfigured: true, apiKeyTail: '9999', model: 'server-m' } };
    const merged = mergeDaemonProviders({ localProviders: local, daemonProviders: daemon }, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({
      apiKeyConfigured: true,
      apiKeyTail: '9999',
      model: 'server-m',
      apiKey: 'being-typed',
    });
  });

  it('lets a preserved local field override the same server field', () => {
    const local: MediaProviderMap = { a: { model: 'being-typed' } };
    const daemon: MediaProviderMap = { a: { apiKeyConfigured: true, model: 'server-m' } };
    const merged = mergeDaemonProviders({ localProviders: local, daemonProviders: daemon }, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({ apiKeyConfigured: true, model: 'being-typed' });
  });

  it('does NOT preserve a named provider whose local entry has only markers', () => {
    // Nothing recoverable to protect — the server copy is strictly better.
    const local: MediaProviderMap = { a: { apiKeyConfigured: true } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '9999' } };
    const merged = mergeDaemonProviders({ localProviders: local, daemonProviders: daemon }, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({ apiKeyTail: '9999' });
  });

  it('does not preserve providers that were not named', () => {
    const local: MediaProviderMap = { a: { apiKey: 'typed-a' }, b: { apiKey: 'typed-b' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '1' }, b: { apiKeyTail: '2' } };
    const merged = mergeDaemonProviders({ localProviders: local, daemonProviders: daemon }, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({ apiKeyTail: '1', apiKey: 'typed-a' });
    expect(merged.b).toEqual({ apiKeyTail: '2' });
  });

  it('adds server providers absent from local', () => {
    expect(mergeDaemonProviders({ localProviders: {}, daemonProviders: { neu: { apiKeyConfigured: true } } })).toEqual({
      neu: { apiKeyConfigured: true },
    });
  });

  it('does not mutate its inputs', () => {
    const local: MediaProviderMap = { a: { apiKey: 'x' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '1' } };
    mergeDaemonProviders({ localProviders: local, daemonProviders: daemon });
    expect(local).toEqual({ a: { apiKey: 'x' } });
    expect(daemon).toEqual({ a: { apiKeyTail: '1' } });
  });

  it('handles null/undefined local providers', () => {
    expect(mergeDaemonProviders({ localProviders: null, daemonProviders: { a: { apiKeyConfigured: true } } })).toEqual({
      a: { apiKeyConfigured: true },
    });
    expect(mergeDaemonProviders({ localProviders: undefined, daemonProviders: null })).toEqual({});
  });
});

describe('mergeDaemonProviders — dropProviderIds', () => {
  it('drops a named local entry when the server is unreachable', () => {
    const local: MediaProviderMap = { a: { apiKey: 'x' }, b: { apiKey: 'y' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: null }, { dropProviderIds: new Set(['a']) })).toEqual({ b: { apiKey: 'y' } });
  });

  it('drops a named local entry when the server manages nothing', () => {
    const local: MediaProviderMap = { a: { apiKey: 'x' }, b: { apiKey: 'y' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: {} }, { dropProviderIds: new Set(['b']) })).toEqual({ a: { apiKey: 'x' } });
  });

  it('does not re-create a cleared provider from the server copy', () => {
    const daemon: MediaProviderMap = { a: { apiKeyConfigured: true }, b: { apiKeyTail: '2' } };
    expect(mergeDaemonProviders({ localProviders: {}, daemonProviders: daemon }, { dropProviderIds: new Set(['a']) })).toEqual({ b: { apiKeyTail: '2' } });
  });

  it('treats an empty drop set as dropping nothing', () => {
    const local: MediaProviderMap = { a: { apiKey: 'x' } };
    expect(mergeDaemonProviders({ localProviders: local, daemonProviders: null }, { dropProviderIds: new Set() })).toEqual(local);
  });
});

describe('isProviderBaseUrlInvalid', () => {
  it('is false when nothing was typed', () => {
    expect(isProviderBaseUrlInvalid({ entry: { baseUrl: '   ' } })).toBe(false);
    expect(isProviderBaseUrlInvalid({ entry: undefined })).toBe(false);
  });

  it('is false for an allowed https url', () => {
    expect(isProviderBaseUrlInvalid({ entry: { baseUrl: 'https://api.example.com/v1' } })).toBe(false);
  });

  it('is true for a non-http scheme', () => {
    expect(isProviderBaseUrlInvalid({ entry: { baseUrl: 'ftp://api.example.com' } })).toBe(true);
  });
});

describe('invalidBaseUrlProviderIds', () => {
  it('returns an empty list for a missing map', () => {
    expect(invalidBaseUrlProviderIds({ providers: null })).toEqual([]);
  });

  it('lists only the providers with an unacceptable typed url', () => {
    const providers: MediaProviderMap = {
      ok: { baseUrl: 'https://api.example.com' },
      bad: { baseUrl: 'ftp://x.example.com' },
      empty: {},
    };
    expect(invalidBaseUrlProviderIds({ providers })).toEqual(['bad']);
  });
});

describe('shouldSyncLocalProvidersToDaemon', () => {
  it('is true only for a first upload: server reachable, empty, and local has real data', () => {
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: { a: { apiKey: 'sk-1' } }, daemonProviders: {} })).toBe(true);
  });

  it('is false when the server is unreachable', () => {
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: { a: { apiKey: 'sk-1' } }, daemonProviders: null })).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: { a: { apiKey: 'sk-1' } }, daemonProviders: undefined })).toBe(false);
  });

  it('is false once the server holds anything — it is authoritative', () => {
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: { a: { apiKey: 'sk-1' } }, daemonProviders: { b: { apiKeyConfigured: true } } })).toBe(
      false,
    );
  });

  it('is false when local has only markers — nothing re-sendable', () => {
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: { a: { apiKeyConfigured: true } }, daemonProviders: {} })).toBe(false);
  });

  it('is false for empty/absent local providers', () => {
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: {}, daemonProviders: {} })).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: null, daemonProviders: {} })).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon({ localProviders: undefined, daemonProviders: {} })).toBe(false);
  });
});

describe('resolveProviderBaseUrl', () => {
  it('prefers what the operator typed', () => {
    expect(resolveProviderBaseUrl({ entry: { baseUrl: 'https://typed' }, defaultBaseUrl: 'https://default' })).toBe('https://typed');
  });

  it('falls back to the catalog default', () => {
    expect(resolveProviderBaseUrl({ entry: {}, defaultBaseUrl: 'https://default' })).toBe('https://default');
    expect(resolveProviderBaseUrl({ entry: { baseUrl: '   ' }, defaultBaseUrl: 'https://default' })).toBe('https://default');
  });

  it('trims both sides', () => {
    expect(resolveProviderBaseUrl({ entry: { baseUrl: '  https://typed  ' }, defaultBaseUrl: undefined })).toBe('https://typed');
    expect(resolveProviderBaseUrl({ entry: {}, defaultBaseUrl: '  https://default  ' })).toBe('https://default');
  });

  it('returns empty when neither exists', () => {
    expect(resolveProviderBaseUrl({ entry: {}, defaultBaseUrl: undefined })).toBe('');
    expect(resolveProviderBaseUrl({ entry: null, defaultBaseUrl: undefined })).toBe('');
  });
});

describe('sortProvidersByConfigured', () => {
  const catalog = [
    { id: 'c', label: 'Charlie' },
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Bravo' },
  ];

  it('puts configured providers before unconfigured ones', () => {
    const providers: MediaProviderMap = { b: { apiKey: 'sk-1' } };
    expect(sortProvidersByConfigured({ catalog, providers }).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('a server-marker-only entry counts as configured too', () => {
    const providers: MediaProviderMap = { c: { apiKeyConfigured: true } };
    expect(sortProvidersByConfigured({ catalog, providers }).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts alphabetically by label within each group', () => {
    expect(sortProvidersByConfigured({ catalog, providers: {} }).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles a null/undefined providers map as "nothing configured"', () => {
    expect(sortProvidersByConfigured({ catalog, providers: null }).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortProvidersByConfigured({ catalog, providers: undefined }).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input catalog', () => {
    const original = [...catalog];
    sortProvidersByConfigured({ catalog, providers: { b: { apiKey: 'sk-1' } } });
    expect(catalog).toEqual(original);
  });

  it('a pinned id renders first, ahead of the configured/alphabetical grouping', () => {
    expect(sortProvidersByConfigured({ catalog, providers: {} }, { pinnedIds: ['c'] }).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('a pinned id stays first even when a different provider is configured', () => {
    const providers: MediaProviderMap = { b: { apiKey: 'sk-1' } };
    expect(sortProvidersByConfigured({ catalog, providers }, { pinnedIds: ['c'] }).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('multiple pinned ids render in the order given, before the rest', () => {
    expect(sortProvidersByConfigured({ catalog, providers: {} }, { pinnedIds: ['b', 'c'] }).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('a pinned id absent from the catalog is silently skipped, not fabricated', () => {
    expect(sortProvidersByConfigured({ catalog, providers: {} }, { pinnedIds: ['does-not-exist', 'c'] }).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('omitting pinnedIds entirely keeps the exact prior configured-first/alphabetical order', () => {
    const providers: MediaProviderMap = { b: { apiKey: 'sk-1' } };
    expect(sortProvidersByConfigured({ catalog, providers }).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('maskedKeyLabel', () => {
  it('never returns the raw key', () => {
    expect(maskedKeyLabel({ entry: { apiKey: 'sk-supersecret-1234' } })).toBe('••••1234');
  });

  it('prefers the server tail over a local key', () => {
    expect(maskedKeyLabel({ entry: { apiKey: 'sk-local-9999', apiKeyTail: '1234' } })).toBe('••••1234');
  });

  it('renders a bare marker with no tail', () => {
    expect(maskedKeyLabel({ entry: { apiKeyConfigured: true } })).toBe('••••');
  });

  it('handles a local key shorter than 4 characters without padding', () => {
    expect(maskedKeyLabel({ entry: { apiKey: 'ab' } })).toBe('••••ab');
  });

  it('is null when nothing is configured', () => {
    expect(maskedKeyLabel({ entry: {} })).toBe(null);
    expect(maskedKeyLabel({ entry: null })).toBe(null);
    expect(maskedKeyLabel({ entry: { apiKey: '   ' } })).toBe(null);
    expect(maskedKeyLabel({ entry: { apiKeyConfigured: false } })).toBe(null);
  });
});

describe('maskedKeyLabel — clamps a server-supplied tail', () => {
  it('never renders more than the last 4 characters, even if the daemon sends the whole key', () => {
    // `apiKeyTail` is documented as "the last few characters" in prose only.
    // A daemon returning the full key would otherwise display the full key
    // behind a `••••` prefix that makes it look masked.
    const label = maskedKeyLabel({ entry: { apiKeyTail: 'sk-ant-api03-FULLSECRETVALUE-wxyz' } });
    expect(label).toBe('••••wxyz');
    expect(label).not.toContain('FULLSECRETVALUE');
  });

  it('still shows a well-behaved short tail unchanged', () => {
    expect(maskedKeyLabel({ entry: { apiKeyTail: 'wxyz' } })).toBe('••••wxyz');
    expect(maskedKeyLabel({ entry: { apiKeyTail: 'xyz' } })).toBe('••••xyz');
  });

  it('clamps a locally-typed key the same way', () => {
    expect(maskedKeyLabel({ entry: { apiKey: 'sk-ant-1234567890wxyz' } })).toBe('••••wxyz');
  });

  it('still reports a marker-only entry and an empty entry unchanged', () => {
    expect(maskedKeyLabel({ entry: { apiKeyConfigured: true } })).toBe('••••');
    expect(maskedKeyLabel({ entry: {} })).toBeNull();
    expect(maskedKeyLabel({ entry: null })).toBeNull();
  });
});
