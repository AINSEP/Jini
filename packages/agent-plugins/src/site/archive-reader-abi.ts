import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from '../lifecycle/index.js';

export function toObjectArgArchiveReader({ reader }: {
  reader: { entries(required: { archive: Uint8Array }): AsyncIterable<Exclude<AgentPluginArchiveEntry, { kind: 'file' }> | (Omit<Extract<AgentPluginArchiveEntry, { kind: 'file' }>, 'openReadStream'> & { openReadStream(): AsyncIterable<Uint8Array> })> };
}, _optional = {}): AgentPluginArchiveReaderPort {
  return {
    async *entries({ archive }) {
      for await (const entry of reader.entries({ archive })) {
        if (entry.kind !== 'file') yield entry;
        else yield { ...entry, openReadStream: (_required: Record<string, never>) => entry.openReadStream() };
      }
    },
  };
}

export function toZeroArgArchiveReader({ reader }: { reader: AgentPluginArchiveReaderPort }, _optional = {}) {
  return {
    async *entries({ archive }: { archive: Uint8Array }) {
      for await (const entry of reader.entries({ archive })) {
        if (entry.kind !== 'file') yield entry;
        else yield { ...entry, openReadStream: () => entry.openReadStream({}) };
      }
    },
  };
}
