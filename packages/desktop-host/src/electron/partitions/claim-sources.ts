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
  const reasons: string[] = [], claimed = new Set<string>(), others = new Set<number>();
  const holderRead = await holders();
  if (holderRead.state === 'unknown') reasons.push(`holders: ${holderRead.reason}`);
  else for (const holder of holderRead.value) {
    for (const partition of [...holder.intents, ...holder.held]) claimed.add(partition);
    if (holder.pid !== selfPid) others.add(holder.pid);
  }
  for (const source of sources.partitions) {
    const read = await source.read();
    if (read.state === 'unknown') reasons.push(`${source.name}: ${read.reason}`);
    else for (const partition of read.value) claimed.add(partition);
  }
  for (const source of sources.instances) {
    const read = await source.read();
    if (read.state === 'unknown') reasons.push(`${source.name}: ${read.reason}`);
    else for (const { pid } of read.value) if (pid !== selfPid) others.add(pid);
  }
  if (reasons.length > 0) return { state: 'unknown', reasons };
  return { state: 'ok', claimed: [...claimed].sort(), otherInstances: [...others].sort((a, b) => a - b) };
}
