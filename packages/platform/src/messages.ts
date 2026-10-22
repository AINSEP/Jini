/** Neutral defaults for shared network, credential and filesystem boundaries.
 * Hosts may replace the whole object; diagnostics retain structured context separately. */
export interface PlatformMessages {
  atomicModeInvalid(): string;
  atomicTempPathInvalid(): string;
  atomicTempNameInvalid(): string;
  atomicSymlinkRefused(): string;
  atomicPermissionsRefused(): string;
  atomicJsonUnserializable(): string;
  fileLockIntervalsInvalid(): string;
  fileLockWriteNoProgress(): string;
  egressRefused(): string;
  rootKeySealedWarning(required: { subject: string }): string;
  fileLockTimeout(required: { waitedMs: number }): string;
  fileLockLost(): string;
}
export const defaultPlatformMessages: PlatformMessages = {
  atomicModeInvalid: () => "atomic file mode must be permission bits between 0000 and 0777",
  atomicTempPathInvalid: () => "atomic temp path must be a different same-directory file",
  atomicTempNameInvalid: () => "atomic temp name must be one safe segment",
  atomicSymlinkRefused: () => "atomic write refused a symbolic-link destination",
  atomicPermissionsRefused: () => "atomic write refused non-owner-only permissions",
  atomicJsonUnserializable: () => "atomic JSON data must be serializable",
  fileLockIntervalsInvalid: () => "file lock intervals must be positive safe integers (timeout may be zero; stale may be Infinity)",
  fileLockWriteNoProgress: () => "file lock ownership write made no progress",
  egressRefused: () => "egress to the requested host was refused by the outbound network policy",
  rootKeySealedWarning: ({ subject }) => `IMPORTANT: anything sealed while ${subject} was in place was sealed under key material derived from these same bytes, `,
  fileLockTimeout: ({ waitedMs }) => `exclusive file lock timed out after ${Math.round(waitedMs)}ms`,
  fileLockLost: () => "exclusive file lock lost ownership before the critical section finished",
};
