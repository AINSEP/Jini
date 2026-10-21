/** Test-only DNS reply builder (uncompressed unless a raw pointer is given). */
export const DNS_NAME = (name: string): number[] => [...name.split('.').filter(label => label !== '').flatMap(label => [label.length, ...new TextEncoder().encode(label)]), 0];

export interface FixtureRecord { readonly owner: number[]; readonly type: number; readonly rdata: number[] }

export const nsRecord = (owner: string | number[], target: string | number[]): FixtureRecord => ({
  owner: typeof owner === 'string' ? DNS_NAME(owner) : owner,
  type: 2,
  rdata: typeof target === 'string' ? DNS_NAME(target) : target,
});

export function dnsReply(required: { id: number; question?: string; rcode?: number; truncated?: boolean; answers?: FixtureRecord[]; authority?: FixtureRecord[] }): Uint8Array {
  const answers = required.answers ?? [];
  const authority = required.authority ?? [];
  const flags = 0x8000 | (required.truncated ? 0x0200 : 0) | (required.rcode ?? 0);
  const question = required.question === undefined ? [] : [...DNS_NAME(required.question), 0, 2, 0, 1];
  const rr = (record: FixtureRecord): number[] => [...record.owner, 0, record.type, 0, 1, 0, 0, 0, 60, record.rdata.length >> 8, record.rdata.length & 0xff, ...record.rdata];
  return Uint8Array.from([
    required.id >> 8, required.id & 0xff, flags >> 8, flags & 0xff,
    0, required.question === undefined ? 0 : 1, 0, answers.length, 0, authority.length, 0, 0,
    ...question, ...answers.flatMap(rr), ...authority.flatMap(rr),
  ]);
}
