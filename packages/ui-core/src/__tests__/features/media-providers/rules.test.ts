import { describe, expect, it } from 'vitest';

// Through the barrel — a symbol missing from `index.ts` fails here rather
// than at some host's build.
import {
  hasAnyConfiguredProvider,
  hasRecoverableFields,
  isEntryEmpty,
  isEntryPresent,
  isMarkerOnlyEntry,
  maskedKeyLabel,
  mergeDaemonProviders,
  resolveProviderBaseUrl,
  shouldSyncLocalProvidersToDaemon,
  sortProvidersByConfigured,
} from '../../../features/media-providers/index.js';
import type { MediaProviderMap } from '../../../features/media-providers/index.js';

/**
 * The whole module turns on ONE distinction — real credential data
 * ("recoverable") vs. a server marker that proves a key exists without
 * carrying it. Most cases below exist to pin that boundary, because getting it
 * backwards silently either wipes an operator's typing or claims a provider is
 * configured after the server forgot it.
 */

describe('hasRecoverableFields', () => {
  it('is true for any real field', () => {
    expect(hasRecoverableFields({ apiKey: 'sk-1' })).toBe(true);
    expect(hasRecoverableFields({ baseUrl: 'https://x' })).toBe(true);
    expect(hasRecoverableFields({ model: 'm' })).toBe(true);
  });

  it('is FALSE for markers only — they carry nothing re-sendable', () => {
    expect(hasRecoverableFields({ apiKeyConfigured: true })).toBe(false);
    expect(hasRecoverableFields({ apiKeyTail: '1234' })).toBe(false);
    expect(hasRecoverableFields({ apiKeyConfigured: true, apiKeyTail: '1234' })).toBe(false);
  });

  it('treats whitespace-only values as absent', () => {
    expect(hasRecoverableFields({ apiKey: '   ', baseUrl: '\t', model: '\n' })).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(hasRecoverableFields(null)).toBe(false);
    expect(hasRecoverableFields(undefined)).toBe(false);
    expect(hasRecoverableFields({})).toBe(false);
  });
});

describe('isEntryPresent / isEntryEmpty', () => {
  it('counts real data as present', () => {
    expect(isEntryPresent({ apiKey: 'sk-1' })).toBe(true);
  });

  it('counts markers as present — a server-held key is still configured', () => {
    expect(isEntryPresent({ apiKeyConfigured: true })).toBe(true);
    expect(isEntryPresent({ apiKeyTail: '1234' })).toBe(true);
  });

  it('does not count apiKeyConfigured:false as present', () => {
    expect(isEntryPresent({ apiKeyConfigured: false })).toBe(false);
  });

  it('does not count a whitespace-only tail as present', () => {
    expect(isEntryPresent({ apiKeyTail: '  ' })).toBe(false);
  });

  it('is empty for nothing at all', () => {
    expect(isEntryPresent({})).toBe(false);
    expect(isEntryPresent(null)).toBe(false);
  });

  it('isEntryEmpty is the exact inverse', () => {
    for (const entry of [{ apiKey: 'k' }, { apiKeyConfigured: true }, {}, null]) {
      expect(isEntryEmpty(entry)).toBe(!isEntryPresent(entry));
    }
  });
});

describe('isMarkerOnlyEntry', () => {
  it('is true for markers with no real data', () => {
    expect(isMarkerOnlyEntry({ apiKeyConfigured: true })).toBe(true);
    expect(isMarkerOnlyEntry({ apiKeyTail: '1234' })).toBe(true);
  });

  it('is false once any real field is present', () => {
    expect(isMarkerOnlyEntry({ apiKeyConfigured: true, apiKey: 'sk-1' })).toBe(false);
    expect(isMarkerOnlyEntry({ apiKeyTail: '1234', baseUrl: 'https://x' })).toBe(false);
  });

  it('is false for an entirely empty entry — nothing to be stale about', () => {
    expect(isMarkerOnlyEntry({})).toBe(false);
    expect(isMarkerOnlyEntry(null)).toBe(false);
  });
});

describe('hasAnyConfiguredProvider', () => {
  it('is true when at least one entry is present', () => {
    expect(hasAnyConfiguredProvider({ a: {}, b: { apiKey: 'k' } })).toBe(true);
  });

  it('is false when every entry is empty', () => {
    expect(hasAnyConfiguredProvider({ a: {}, b: { apiKey: '  ' } })).toBe(false);
  });

  it('is false for an empty map, null, or undefined', () => {
    expect(hasAnyConfiguredProvider({})).toBe(false);
    expect(hasAnyConfiguredProvider(null)).toBe(false);
    expect(hasAnyConfiguredProvider(undefined)).toBe(false);
  });
});

describe('mergeDaemonProviders', () => {
  it('returns local untouched when the server was never reached (null)', () => {
    // null means UNREACHABLE, not "server has nothing" — a network blip must
    // not wipe local edits. This is the case a `?? {}` default would break.
    const local: MediaProviderMap = { a: { apiKey: 'typed' }, b: { apiKeyConfigured: true } };
    expect(mergeDaemonProviders(local, null)).toEqual(local);
    expect(mergeDaemonProviders(local, undefined)).toEqual(local);
  });

  it('returns a COPY, not the same reference', () => {
    const local: MediaProviderMap = { a: { apiKey: 'typed' } };
    expect(mergeDaemonProviders(local, null)).not.toBe(local);
  });

  it('drops stale marker-only entries when the server manages nothing', () => {
    const local: MediaProviderMap = { stale: { apiKeyConfigured: true }, typed: { apiKey: 'sk-1' } };
    expect(mergeDaemonProviders(local, {})).toEqual({ typed: { apiKey: 'sk-1' } });
  });

  it('keeps locally-typed entries when the server manages nothing', () => {
    // The operator typed these and no server has claimed them — dropping them
    // would discard unsaved work.
    const local: MediaProviderMap = { a: { baseUrl: 'https://local' } };
    expect(mergeDaemonProviders(local, { b: {} })).toEqual(local);
  });

  it('lets a present server entry win over local', () => {
    const local: MediaProviderMap = { a: { apiKey: 'old', model: 'old-m' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '9999', apiKeyConfigured: true } };
    expect(mergeDaemonProviders(local, daemon)).toEqual({ a: { apiKeyTail: '9999', apiKeyConfigured: true } });
  });

  it('skips a server entry that is not present, leaving local intact', () => {
    const local: MediaProviderMap = { a: { apiKey: 'keepme' } };
    const daemon: MediaProviderMap = { a: {}, b: { apiKeyConfigured: true } };
    const merged = mergeDaemonProviders(local, daemon);
    expect(merged.a).toEqual({ apiKey: 'keepme' });
    expect(merged.b).toEqual({ apiKeyConfigured: true });
  });

  it('preserves a named local edit ON TOP of the server entry', () => {
    // Layering, not replacing: server-only markers must survive alongside the
    // in-progress edit.
    const local: MediaProviderMap = { a: { apiKey: 'being-typed' } };
    const daemon: MediaProviderMap = { a: { apiKeyConfigured: true, apiKeyTail: '9999', model: 'server-m' } };
    const merged = mergeDaemonProviders(local, daemon, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({
      apiKeyConfigured: true,
      apiKeyTail: '9999',
      model: 'server-m',
      apiKey: 'being-typed',
    });
  });

  it('does NOT preserve a named provider whose local entry has only markers', () => {
    // Nothing recoverable to protect — the server copy is strictly better.
    const local: MediaProviderMap = { a: { apiKeyConfigured: true } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '9999' } };
    const merged = mergeDaemonProviders(local, daemon, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({ apiKeyTail: '9999' });
  });

  it('does not preserve providers that were not named', () => {
    const local: MediaProviderMap = { a: { apiKey: 'typed-a' }, b: { apiKey: 'typed-b' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '1' }, b: { apiKeyTail: '2' } };
    const merged = mergeDaemonProviders(local, daemon, { preserveLocalProviderIds: new Set(['a']) });
    expect(merged.a).toEqual({ apiKeyTail: '1', apiKey: 'typed-a' });
    expect(merged.b).toEqual({ apiKeyTail: '2' });
  });

  it('adds server providers absent from local', () => {
    expect(mergeDaemonProviders({}, { neu: { apiKeyConfigured: true } })).toEqual({
      neu: { apiKeyConfigured: true },
    });
  });

  it('does not mutate its inputs', () => {
    const local: MediaProviderMap = { a: { apiKey: 'x' } };
    const daemon: MediaProviderMap = { a: { apiKeyTail: '1' } };
    mergeDaemonProviders(local, daemon);
    expect(local).toEqual({ a: { apiKey: 'x' } });
    expect(daemon).toEqual({ a: { apiKeyTail: '1' } });
  });

  it('handles null/undefined local providers', () => {
    expect(mergeDaemonProviders(null, { a: { apiKeyConfigured: true } })).toEqual({
      a: { apiKeyConfigured: true },
    });
    expect(mergeDaemonProviders(undefined, null)).toEqual({});
  });
});

describe('shouldSyncLocalProvidersToDaemon', () => {
  it('is true only for a first upload: server reachable, empty, and local has real data', () => {
    expect(shouldSyncLocalProvidersToDaemon({ a: { apiKey: 'sk-1' } }, {})).toBe(true);
  });

  it('is false when the server is unreachable', () => {
    expect(shouldSyncLocalProvidersToDaemon({ a: { apiKey: 'sk-1' } }, null)).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon({ a: { apiKey: 'sk-1' } }, undefined)).toBe(false);
  });

  it('is false once the server holds anything — it is authoritative', () => {
    expect(shouldSyncLocalProvidersToDaemon({ a: { apiKey: 'sk-1' } }, { b: { apiKeyConfigured: true } })).toBe(
      false,
    );
  });

  it('is false when local has only markers — nothing re-sendable', () => {
    expect(shouldSyncLocalProvidersToDaemon({ a: { apiKeyConfigured: true } }, {})).toBe(false);
  });

  it('is false for empty/absent local providers', () => {
    expect(shouldSyncLocalProvidersToDaemon({}, {})).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon(null, {})).toBe(false);
    expect(shouldSyncLocalProvidersToDaemon(undefined, {})).toBe(false);
  });
});

describe('resolveProviderBaseUrl', () => {
  it('prefers what the operator typed', () => {
    expect(resolveProviderBaseUrl({ baseUrl: 'https://typed' }, 'https://default')).toBe('https://typed');
  });

  it('falls back to the catalog default', () => {
    expect(resolveProviderBaseUrl({}, 'https://default')).toBe('https://default');
    expect(resolveProviderBaseUrl({ baseUrl: '   ' }, 'https://default')).toBe('https://default');
  });

  it('trims both sides', () => {
    expect(resolveProviderBaseUrl({ baseUrl: '  https://typed  ' }, undefined)).toBe('https://typed');
    expect(resolveProviderBaseUrl({}, '  https://default  ')).toBe('https://default');
  });

  it('returns empty when neither exists', () => {
    expect(resolveProviderBaseUrl({}, undefined)).toBe('');
    expect(resolveProviderBaseUrl(null, undefined)).toBe('');
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
    expect(sortProvidersByConfigured(catalog, providers).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('a server-marker-only entry counts as configured too', () => {
    const providers: MediaProviderMap = { c: { apiKeyConfigured: true } };
    expect(sortProvidersByConfigured(catalog, providers).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts alphabetically by label within each group', () => {
    expect(sortProvidersByConfigured(catalog, {}).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles a null/undefined providers map as "nothing configured"', () => {
    expect(sortProvidersByConfigured(catalog, null).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(sortProvidersByConfigured(catalog, undefined).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input catalog', () => {
    const original = [...catalog];
    sortProvidersByConfigured(catalog, { b: { apiKey: 'sk-1' } });
    expect(catalog).toEqual(original);
  });
});

describe('maskedKeyLabel', () => {
  it('never returns the raw key', () => {
    expect(maskedKeyLabel({ apiKey: 'sk-supersecret-1234' })).toBe('••••1234');
  });

  it('prefers the server tail over a local key', () => {
    expect(maskedKeyLabel({ apiKey: 'sk-local-9999', apiKeyTail: '1234' })).toBe('••••1234');
  });

  it('renders a bare marker with no tail', () => {
    expect(maskedKeyLabel({ apiKeyConfigured: true })).toBe('••••');
  });

  it('handles a local key shorter than 4 characters without padding', () => {
    expect(maskedKeyLabel({ apiKey: 'ab' })).toBe('••••ab');
  });

  it('is null when nothing is configured', () => {
    expect(maskedKeyLabel({})).toBe(null);
    expect(maskedKeyLabel(null)).toBe(null);
    expect(maskedKeyLabel({ apiKey: '   ' })).toBe(null);
    expect(maskedKeyLabel({ apiKeyConfigured: false })).toBe(null);
  });
});
