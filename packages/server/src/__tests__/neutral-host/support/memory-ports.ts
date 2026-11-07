/**
 * In-memory stand-ins for the stores a host supplies: a credential vault, an envelope sealer and a
 * settings store. Each counts its own calls into the shared cost counters. They hold no product
 * policy; the moved code's own ports adapt to them as each batch arrives.
 */
import { byteLength, type CostCounters } from './counters.ts';

export interface MemoryVaultRow { readonly workspaceId: string; readonly key: string; readonly value: string }

export interface MemoryVault {
  put(required: MemoryVaultRow): void;
  get(required: { readonly workspaceId: string; readonly key: string }): string | undefined;
  /** Every row in the workspace, as a vault listing returns it. Counted. */
  list(required: { readonly workspaceId: string }): readonly MemoryVaultRow[];
  delete(required: { readonly workspaceId: string; readonly key: string }): boolean;
}

/** A vault keyed by workspace and key. `list` counts one call, its rows and their bytes. */
export function createMemoryVault(required: { readonly counters: CostCounters }, _optional: Record<string, never> = {}): MemoryVault {
  const rows = new Map<string, MemoryVaultRow>();
  const id = (workspaceId: string, key: string) => JSON.stringify([workspaceId, key]);
  return {
    put: row => { rows.set(id(row.workspaceId, row.key), { ...row }); },
    get: ({ workspaceId, key }) => rows.get(id(workspaceId, key))?.value,
    list: ({ workspaceId }) => {
      const found = [...rows.values()].filter(row => row.workspaceId === workspaceId);
      required.counters.add({ name: 'vaultListCalls' });
      required.counters.add({ name: 'vaultListRows' }, { by: found.length });
      required.counters.add({ name: 'vaultListBytes' }, { by: byteLength({ value: found }) });
      return found;
    },
    delete: ({ workspaceId, key }) => rows.delete(id(workspaceId, key)),
  };
}

export interface MemorySealer {
  seal(required: { readonly plaintext: string }): string;
  /** Counted: one open and the bytes opened. */
  open(required: { readonly envelope: string }): string;
}

const ENVELOPE_PREFIX = 'sealed:';

/** A reversible, clearly fake sealer. It protects nothing and exists only to count opens. */
export function createMemorySealer(required: { readonly counters: CostCounters }, _optional: Record<string, never> = {}): MemorySealer {
  return {
    seal: ({ plaintext }) => `${ENVELOPE_PREFIX}${Buffer.from(plaintext, 'utf8').toString('base64')}`,
    open: ({ envelope }) => {
      if (!envelope.startsWith(ENVELOPE_PREFIX)) throw new Error('not a sealed envelope');
      const plaintext = Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), 'base64').toString('utf8');
      required.counters.add({ name: 'sealerOpens' });
      required.counters.add({ name: 'sealerOpenBytes' }, { by: byteLength({ value: plaintext }) });
      return plaintext;
    },
  };
}

export interface MemorySettings {
  read(required: { readonly workspaceId: string; readonly key: string }): unknown;
  write(required: { readonly workspaceId: string; readonly key: string; readonly value: unknown }): void;
}

/** Settings keyed by workspace and key. Values are copied in and out, as a real store would. */
export function createMemorySettings(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): MemorySettings {
  const values = new Map<string, string>();
  const id = (workspaceId: string, key: string) => JSON.stringify([workspaceId, key]);
  return {
    read: ({ workspaceId, key }) => {
      const raw = values.get(id(workspaceId, key));
      return raw === undefined ? undefined : JSON.parse(raw) as unknown;
    },
    write: ({ workspaceId, key, value }) => { values.set(id(workspaceId, key), JSON.stringify(value)); },
  };
}
