import { describe, expect, test, vi } from 'vitest';
import { ADAPTER_KIND, type Contribution, type SlotKind, type SlotProblem } from '../contract.js';
import { ADAPTER_SLOT, createPluginRegistry } from '../plugins.js';

type Signature = Contribution<'tracker-signature'> & { srcHosts: string[] };
const SIGNATURE_SLOT: SlotKind<Signature> = {
  kind: 'tracker-signature',
  accept: ({ contribution: c }) => (Array.isArray(c.srcHosts) ? (c as unknown as Signature) : 'srcHosts must be a list'),
};

describe('createPluginRegistry', () => {
  test('a contribution to an unknown kind waits, then registers when its slot is defined', () => {
    const registry = createPluginRegistry({}, { slots: [ADAPTER_SLOT] });
    const seen = vi.fn();
    registry.subscribe({ kind: 'tracker-signature', listener: seen });
    registry.registerPlugin({ id: 'stats', kind: 'tracker-signature', srcHosts: ['stats.example'] });
    expect(registry.list({ kind: 'tracker-signature' })).toEqual([]);
    expect(seen).not.toHaveBeenCalled();

    registry.defineSlot({ slot: SIGNATURE_SLOT });
    expect(registry.list<Signature>({ kind: 'tracker-signature' }).map(s => s.srcHosts)).toEqual([['stats.example']]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('defining one slot leaves contributions parked for other kinds; refusals without onProblem are silent', () => {
    const registry = createPluginRegistry();
    registry.registerPlugin({ id: 'later', kind: 'consent-log-sink' });
    registry.registerPlugin({ id: 'stats', kind: 'tracker-signature', srcHosts: [] });
    registry.defineSlot({ slot: SIGNATURE_SLOT });
    expect(registry.list({ kind: 'tracker-signature' })).toHaveLength(1);
    expect(registry.list({ kind: 'consent-log-sink' })).toEqual([]);
    expect(() => registry.registerPlugin({ id: 'Bad Id', kind: 'tracker-signature', srcHosts: [] })).not.toThrow();
  });

  test('disposing a parked contribution before its slot exists means it never registers', () => {
    const registry = createPluginRegistry();
    const dispose = registry.registerPlugin({ id: 'stats', kind: 'tracker-signature', srcHosts: [] });
    dispose();
    registry.defineSlot({ slot: SIGNATURE_SLOT });
    expect(registry.list({ kind: 'tracker-signature' })).toEqual([]);
  });

  test('the disposer of a parked contribution removes it after it was admitted', () => {
    const registry = createPluginRegistry();
    const dispose = registry.registerPlugin({ id: 'stats', kind: 'tracker-signature', srcHosts: [] });
    registry.defineSlot({ slot: SIGNATURE_SLOT });
    registry.defineSlot({ slot: { ...SIGNATURE_SLOT, accept: () => 'never used' } });   // first definition wins
    expect(registry.list({ kind: 'tracker-signature' })).toHaveLength(1);
    dispose();
    dispose();
    expect(registry.list({ kind: 'tracker-signature' })).toEqual([]);
  });

  test('bad ids, refused contributions and duplicate ids are reported, never guessed', () => {
    const problems: SlotProblem[] = [];
    const registry = createPluginRegistry({}, { slots: [ADAPTER_SLOT], onProblem: p => problems.push(p) });
    const grant = () => null;
    registry.registerPlugin({ id: 'Bad Id', kind: ADAPTER_KIND, category: 'analytics', grant }, { source: 'page' });
    registry.registerPlugin({ id: 'a', kind: ADAPTER_KIND, category: 'necessary', grant });
    registry.registerPlugin({ id: 'b', kind: ADAPTER_KIND, category: 'analytics' });
    registry.registerPlugin({ id: 'c', kind: ADAPTER_KIND, category: 'analytics', grant });
    const dup = registry.registerPlugin({ id: 'c', kind: ADAPTER_KIND, category: 'marketing', src: '/c.mjs' });
    dup();
    expect(problems.map(p => [p.id, p.reason, p.source])).toEqual([
      ['Bad Id', 'the id must be a short lowercase name', 'page'],
      ['a', 'category must be functional, analytics or marketing', undefined],
      ['b', 'an adapter needs grant() or a module src', undefined],
      ['c', 'this id is already registered', undefined],
    ]);
    expect(registry.list({ kind: ADAPTER_KIND }).map(a => a.id)).toEqual(['c']);
  });

  test('lists by priority, isolates a throwing listener and stops notifying after unsubscribe', () => {
    const registry = createPluginRegistry({}, { slots: [SIGNATURE_SLOT] });
    const later = vi.fn();
    registry.subscribe({ kind: 'tracker-signature', listener: () => { throw new Error('broken listener'); } });
    const off = registry.subscribe({ kind: 'tracker-signature', listener: later });
    registry.registerPlugin({ id: 'low', kind: 'tracker-signature', srcHosts: [] }, { priority: -10 });
    registry.registerPlugin({ id: 'high', kind: 'tracker-signature', srcHosts: [] }, { priority: 5 });
    registry.registerPlugin({ id: 'mid', kind: 'tracker-signature', srcHosts: [] });
    expect(registry.list({ kind: 'tracker-signature' }).map(s => s.id)).toEqual(['high', 'mid', 'low']);
    expect(later).toHaveBeenCalledTimes(3);
    off();
    registry.registerPlugin({ id: 'more', kind: 'tracker-signature', srcHosts: [] });
    expect(later).toHaveBeenCalledTimes(3);
  });
});
