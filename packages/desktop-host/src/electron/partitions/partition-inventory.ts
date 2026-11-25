import type { ClaimsRead } from './claim-sources.js';
import type { CandidateList, PartitionCandidate, PartitionRootRead } from './partition-root.js';
import type { PartitionPassLedger } from './partition-pass.js';

export type PartitionInventory =
  | { state: 'unknown' }
  | { state: 'ok'; candidates: readonly PartitionCandidate[] };

export function isAmbiguousPartitionEligible(
  { partition, claims, ledger }: { partition: string; claims: ClaimsRead; ledger: ReturnType<PartitionPassLedger['readStrict']> },
  _optional = {},
): boolean {
  return claims.state === 'ok' && ledger.state === 'ok' && claims.otherInstances.length === 0 &&
    !claims.claimed.includes(partition) && !ledger.records.some(record => record.partition === partition && record.state === 'pending');
}

export async function listAmbiguousPartitions(
  { readRoot, list, readClaims, readLedger }: {
    readRoot: () => Promise<PartitionRootRead>;
    list: (required: { root: string }) => Promise<CandidateList>;
    readClaims: () => Promise<ClaimsRead>;
    readLedger: () => ReturnType<PartitionPassLedger['readStrict']>;
  },
  _optional = {},
): Promise<PartitionInventory> {
  const root = await readRoot();
  if (root.state === 'absent') return { state: 'ok', candidates: [] };
  if (root.state === 'unknown') return { state: 'unknown' };
  const candidates = await list({ root: root.root });
  if (candidates.state === 'unknown') return { state: 'unknown' };
  const claims = await readClaims(), ledger = readLedger();
  if (claims.state === 'unknown' || ledger.state === 'unknown') return { state: 'unknown' };
  return { state: 'ok', candidates: candidates.candidates.filter(candidate => isAmbiguousPartitionEligible({ partition: candidate.name, claims, ledger })) };
}
