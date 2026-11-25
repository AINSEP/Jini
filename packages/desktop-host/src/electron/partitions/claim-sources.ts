import { readPresenceStrict } from '../updates/instance-presence-strict.js';
import type { ReadPresenceStrictInput } from '../updates/instance-presence-strict.js';

/** Every claim reader answers `ok` with a complete value or `unknown`; there is no partial answer. */
export type StrictRead<T> = { state: 'ok'; value: T } | { state: 'unknown'; reason: string };

/** A host-supplied set of partition directory names that must be kept (tracked list, catalog, ...). */
export interface PartitionClaimSource {
  name: string;
  read(): Promise<StrictRead<readonly string[]>>;
}
/** A host-supplied set of other live instances of the same profile (for example updater presence). */
export interface InstanceClaimSource {
  name: string;
  read(): Promise<StrictRead<readonly { pid: number }[]>>;
}
export interface PartitionClaimSources {
  partitions: readonly PartitionClaimSource[];
  instances: readonly InstanceClaimSource[];
}
export interface HolderClaims { pid: number; intents: readonly string[]; held: readonly string[] }

export type ClaimsRead =
  | { state: 'ok'; claimed: string[]; otherInstances: number[] }
  | { state: 'unknown'; reasons: string[] };

/** Adapt the strict updater-presence reader as an instance claim source. @complexity O(n) records. */
export function presenceClaimSource(
  { directory, fs, liveness }: ReadPresenceStrictInput,
  { name = 'presence' }: { name?: string } = {},
): InstanceClaimSource {
  return { name, read: async () => readPresenceStrict({ directory, fs, liveness }) };
}

interface ClaimTally { reasons: string[]; claimed: Set<string>; others: Set<number> }

async function tallySource<T>(tally: ClaimTally, name: string, read: () => Promise<StrictRead<readonly T[]>>, add: (item: T) => void): Promise<void> {
  const result = await read();
  if (result.state === 'unknown') tally.reasons.push(`${name}: ${result.reason}`);
  else result.value.forEach(add);
}

/**
 * Union of every live holder's intents and held partitions (this process included), every partition
 * source, and every other live instance. One `unknown` source makes the whole answer `unknown`:
 * an unknown claim never authorizes mutation, so it must not be narrowed to "no claim".
 * @complexity O(total claims).
 */
export async function readClaimsStrict(
  { selfPid, holders, sources }: { selfPid: number; holders: () => Promise<StrictRead<readonly HolderClaims[]>>; sources: PartitionClaimSources },
  _optional: Record<string, never> = {},
): Promise<ClaimsRead> {
  const tally: ClaimTally = { reasons: [], claimed: new Set(), others: new Set() };
  const addInstance = (pid: number) => { if (pid !== selfPid) tally.others.add(pid); };
  await tallySource<HolderClaims>(tally, 'holders', holders, holder => {
    for (const partition of [...holder.intents, ...holder.held]) tally.claimed.add(partition);
    addInstance(holder.pid);
  });
  for (const source of sources.partitions) await tallySource<string>(tally, source.name, () => source.read(), p => tally.claimed.add(p));
  for (const source of sources.instances) await tallySource<{ pid: number }>(tally, source.name, () => source.read(), ({ pid }) => addInstance(pid));
  if (tally.reasons.length > 0) return { state: 'unknown', reasons: tally.reasons };
  return { state: 'ok', claimed: [...tally.claimed].sort(), otherInstances: [...tally.others].sort((a, b) => a - b) };
}
