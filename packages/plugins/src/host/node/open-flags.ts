/**
 * @file The flags `package-files.ts` opens every packaged file with, computed from the platform's
 * `fs.constants` passed in, so the Windows shape (no `O_NOFOLLOW`) is as checkable as the POSIX one.
 * Internal to the node tier; not re-exported from `./index.ts`.
 */

/** The subset of `fs.constants` the read-only, no-follow open needs. */
export interface OpenFlagConstants {
  readonly O_RDONLY: number;
  readonly O_NOFOLLOW?: number | undefined;
}

/**
 * Read-only, and refusing a final-component symlink wherever the platform can express that.
 * @complexity O(1).
 */
export function readNoFollowFlags({ constants }: { constants: OpenFlagConstants }, _optional: Record<string, never> = {}): number {
  // `O_NOFOLLOW` is undefined on Windows; `?? 0` keeps the open valid there.
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
}
