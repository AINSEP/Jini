import { withFileLock } from "./file-lock.js";

/** A held claim on one directory identity; `token` is what {@link LeasedDirectoryMovePorts.release} needs back. */
export type DirectoryMoveClaim = { acquired: true; token: string } | { acquired: false };

/** What the host supplies to {@link moveDirectoryUnderLeases}: it decides what "idle" means, how identities are
 *  claimed and released, how the bytes move, and the operator copy of each refusal. */
export interface LeasedDirectoryMovePorts {
  /** Throws when the source is running or any of its resources is still open. */
  assertIdle(required: { from: string }): void;
  /** Reserves one directory identity against other apps booting it. */
  claim(required: { path: string }): DirectoryMoveClaim;
  release(required: { path: string; token: string }): void;
  /** Creates whatever the destination needs (for example its parent folder) before the move. */
  prepareDestination(required: { to: string }): void;
  /** The verified relocation itself (a throw leaves the verified destination or the original, never an overwrite). */
  relocate(required: { from: string; to: string }): void;
  sourceClaimRefused(required: { path: string }): Error;
  targetClaimRefused(required: { path: string }): Error;
}

/**
 * Move one idle directory under its destination's creation lock while both identities are reserved.
 * @throws A refusal from `ports`, an idleness error, or whatever `relocate` throws; both claims are released either way.
 * @complexity The relocation's own cost plus O(1) lock and claim work.
 */
export async function moveDirectoryUnderLeases(
  { from, to, ports }: { from: string; to: string; ports: LeasedDirectoryMovePorts },
  _optional = {},
): Promise<void> {
  await withFileLock({ lockPath: `${to}.creation.lock`, run: async () => {
    ports.assertIdle({ from });
    const reservation = ports.claim({ path: from });
    if (!reservation.acquired) throw ports.sourceClaimRefused({ path: from });
    let targetToken: string | undefined;
    try {
      const targetReservation = ports.claim({ path: to });
      if (!targetReservation.acquired) throw ports.targetClaimRefused({ path: to });
      targetToken = targetReservation.token;
      ports.prepareDestination({ to });
      ports.relocate({ from, to });
    } finally {
      // Release at the new path only after the move, so cleanup never recreates the source.
      // Leases can live outside either folder, so release both identities even after the source moves.
      ports.release({ path: from, token: reservation.token });
      if (targetToken) ports.release({ path: to, token: targetToken });
    }
  } }, { createParent: true, staleMs: Infinity });
}
