/** @file Generic plugin registry: universal, no DOM, no Node. Any package can add a slot kind with
 * defineSlot(); contributions to kinds this build doesn't know wait instead of failing, so a new kind
 * (a tracker signature, a consent log sink, ...) never needs a change here. */
import { ADAPTER_KIND, OPTIONAL, type AdapterContribution, type Contribution, type PluginRegistry,
  type RawContribution, type RegistrationOptions, type SlotKind, type SlotProblem } from './contract.js';

type Held = { kind: string; id: string; value: Contribution; priority: number };
type Parked = { raw: RawContribution; options: RegistrationOptions; dispose: () => void };
type Listener = { kind: string; fn: (items: readonly Contribution[]) => void };
const ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
type RegistryOptions = { slots?: readonly SlotKind[]; onProblem?: (problem: SlotProblem) => void };

/** @example createPluginRegistry({}, { slots: [ADAPTER_SLOT], onProblem: report })
 * @complexity O(n log n) per list(); O(parked) per defineSlot(). Registries hold a handful of entries. */
export function createPluginRegistry(_required: object = {}, { slots = [], onProblem = () => undefined }: RegistryOptions = {}): PluginRegistry {
  const kinds = new Map<string, SlotKind>();
  const held: Held[] = [];
  const parked = new Set<Parked>();
  const listeners = new Set<Listener>();

  const list = <T extends Contribution>(kind: string): readonly T[] =>
    held.filter(h => h.kind === kind).sort((a, b) => b.priority - a.priority).map(h => h.value as T);
  const emit = (kind: string) => listeners.forEach(l => { if (l.kind === kind) try { l.fn(list(kind)); } catch { /* isolate */ } });

  /** Duplicate ids are refused, never guessed (same rule as Tovu's contribution loaders). */
  function admit(raw: RawContribution, options: RegistrationOptions): () => void {
    const refuse = (reason: string) => { onProblem({ id: String(raw.id), kind: raw.kind, reason, ...(options.source ? { source: options.source } : {}) }); return () => undefined; };
    if (!ID.test(String(raw.id))) return refuse('short lowercase id');
    const value = kinds.get(raw.kind)!.accept({ contribution: raw });
    if (typeof value === 'string') return refuse(value);
    if (held.some(h => h.kind === raw.kind && h.id === raw.id)) return refuse('duplicate id');
    const entry: Held = { kind: raw.kind, id: raw.id, value, priority: options.priority ?? 0 };
    held.push(entry);
    emit(raw.kind);
    return () => { const at = held.indexOf(entry); if (at >= 0) { held.splice(at, 1); emit(raw.kind); } };
  }

  const registry: PluginRegistry = {
    defineSlot({ slot }) {
      if (kinds.has(slot.kind)) return;
      kinds.set(slot.kind, slot);
      for (const item of parked) {
        if (item.raw.kind !== slot.kind) continue;
        parked.delete(item);
        item.dispose = admit(item.raw, item.options);        // the caller's disposer now removes the admitted entry
      }
    },
    registerPlugin(raw, options = {}) {
      if (kinds.has(raw.kind)) return admit(raw, options);
      const item: Parked = { raw, options, dispose: () => { parked.delete(item); } };
      parked.add(item);
      return () => item.dispose();
    },
    list: ({ kind }) => list(kind),
    subscribe({ kind, listener }) {
      const entry: Listener = { kind, fn: listener };
      listeners.add(entry);
      return () => { listeners.delete(entry); };
    },
  };
  for (const slot of slots) registry.defineSlot({ slot });
  return registry;
}

/** The browser consent-adapter slot: a live adapter (grant()) or a lazy one (module src). */
export const ADAPTER_SLOT: SlotKind<AdapterContribution> = {
  kind: ADAPTER_KIND,
  accept({ contribution: c }) {
    if (!(OPTIONAL as readonly unknown[]).includes(c.category)) return 'category must be functional, analytics or marketing';
    if (typeof c.grant === 'function' || typeof c.src === 'string') return c as unknown as AdapterContribution;
    return 'grant() or src needed';
  },
};
