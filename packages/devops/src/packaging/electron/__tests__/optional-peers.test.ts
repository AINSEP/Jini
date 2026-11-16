import { describe, expect, it } from 'vitest';
import { optionalPeerClassification, optionalPeerContractProblems, type OptionalPeerManifest } from '../optional-peers.js';

const GOOD = 'opt-in: terminal — needs smol-toml installed';
const m = (over: Partial<OptionalPeerManifest> = {}): OptionalPeerManifest => ({
  name: '@jini-ai/x', peerDependencies: { dep: '*' }, peerDependenciesMeta: { dep: { optional: true } }, jini: { optionalPeers: { dep: GOOD } }, ...over,
});

describe('optionalPeerClassification', () => {
  it('returns the declared opt-in message for a classified optional peer', () => {
    expect(optionalPeerClassification({ manifest: m(), name: 'dep' })).toBe(GOOD);
  });

  it('accepts an en dash separator', () => {
    const en = 'opt-in: feature – message text';
    expect(optionalPeerClassification({ manifest: m({ jini: { optionalPeers: { dep: en } } }), name: 'dep' })).toBe(en);
  });

  it.each([
    ['hyphen separator', 'opt-in: feature - message'],
    ['no opt-in prefix', 'feature — message'],
    ['empty feature', 'opt-in:  — message'],
    ['no message', 'opt-in: feature — '],
    ['empty', ''],
  ])('refuses a malformed message: %s', (_n, value) => {
    expect(optionalPeerClassification({ manifest: m({ jini: { optionalPeers: { dep: value } } }), name: 'dep' })).toBeUndefined();
  });

  it('refuses a non-string message', () => {
    expect(optionalPeerClassification({ manifest: m({ jini: { optionalPeers: { dep: 5 as never } } }), name: 'dep' })).toBeUndefined();
  });

  it('is undefined when the dependency is not an optional peer', () => {
    expect(optionalPeerClassification({ manifest: m({ peerDependenciesMeta: { dep: { optional: false } } }), name: 'dep' })).toBeUndefined();
    expect(optionalPeerClassification({ manifest: m({ peerDependenciesMeta: { dep: {} } }), name: 'dep' })).toBeUndefined();
    expect(optionalPeerClassification({ manifest: m({ peerDependenciesMeta: undefined }), name: 'dep' })).toBeUndefined();
    expect(optionalPeerClassification({ manifest: m({ peerDependencies: undefined }), name: 'dep' })).toBeUndefined();
    expect(optionalPeerClassification({ manifest: m({ peerDependencies: {} }), name: 'dep' })).toBeUndefined();
  });

  it('is undefined when the optional peer has no declared feature', () => {
    expect(optionalPeerClassification({ manifest: m({ jini: undefined }), name: 'dep' })).toBeUndefined();
    expect(optionalPeerClassification({ manifest: m({ jini: { optionalPeers: {} } }), name: 'dep' })).toBeUndefined();
  });

  it('only classifies the named dependency', () => {
    expect(optionalPeerClassification({ manifest: m(), name: 'other' })).toBeUndefined();
  });
});

describe('optionalPeerContractProblems', () => {
  it('lists optional peers with no valid classification', () => {
    const manifest = m({ peerDependenciesMeta: { dep: { optional: true }, bad: { optional: true } }, peerDependencies: { dep: '*', bad: '*' } });
    expect(optionalPeerContractProblems({ manifest })).toEqual(['unclassified optional peer bad; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required']);
  });

  it('reports an optional peer whose message is malformed', () => {
    const manifest = m({ jini: { optionalPeers: { dep: 'nonsense' } } });
    expect(optionalPeerContractProblems({ manifest })).toEqual(['unclassified optional peer dep; declare jini.optionalPeers with opt-in feature and user-facing message, or make it required']);
  });

  it('reports an optional meta with no matching peer dependency', () => {
    expect(optionalPeerContractProblems({ manifest: m({ peerDependencies: {} }) })).toHaveLength(1);
  });

  it('ignores non-optional meta entries', () => {
    expect(optionalPeerContractProblems({ manifest: m({ peerDependenciesMeta: { dep: { optional: false }, other: {} } }) })).toEqual([]);
  });

  it('is empty for a classified manifest and for one without meta', () => {
    expect(optionalPeerContractProblems({ manifest: m() })).toEqual([]);
    expect(optionalPeerContractProblems({ manifest: { name: 'x' } })).toEqual([]);
  });
});
