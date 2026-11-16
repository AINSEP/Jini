import type { Clock } from "../../primitives/index.js";

export interface FileLockHolder { readonly pid: number; readonly hostname: string; readonly token: string; readonly acquiredAt: string; readonly bootId?: string; }
export interface HeldFileLock { readonly lockPath: string; assertHeld(required: Record<string, never>): Promise<void>; }
export interface HeldFileLockSync { readonly lockPath: string; assertHeld(required: Record<string, never>): void; }
export interface BootIdentity { id: string; startedAtMs: number; }

export interface FileLockMessages { fileLockTimeout(required: { waitedMs: number }): string; fileLockLost(): string; }
export const DEFAULT_FILE_LOCK_MESSAGES: FileLockMessages = {
  fileLockTimeout: ({ waitedMs }) => `exclusive file lock timed out after ${Math.round(waitedMs)}ms`,
  fileLockLost: () => "exclusive file lock lost ownership before the critical section finished",
};

/** Options every FileLockPort implementation honours. */
export interface FileLockPortOptions<Filesystem = never> {
  /** Infinity follows an operation with its own deadline; dead local owners remain reclaimable. */
  timeoutMs?: number;
  /** Age threshold for unknown owners. Proven live owners are never evicted; Infinity disables age recovery. */
  staleMs?: number;
  pollMs?: number;
  clock?: Clock;
  /** Times the wait budget (start and timeout check). Defaults to `clock.nowMs`; hosts with a
   * monotonic source pass it so a wall-clock jump can neither end nor stretch the wait. Stale age
   * stays on `clock.nowMs`, because lock-file mtimes are wall-clock times. */
  monotonicMs?: () => number;
  sleep?: (required: { durationMs: number }) => void | Promise<void>;
  process?: { pid: number; isAlive(required: { pid: number }): boolean; bootIdentity?: () => BootIdentity | undefined };
  token?: () => string;
  hostname?: () => string;
  onStaleLockRemoved?: (required: { holder: FileLockHolder | undefined }) => void;
  createParent?: boolean;
  format?: "json" | "token";
  /** Host stores keep their existing user-facing timeout copy. */
  timeoutMessage?: (required: { lockPath: string; waitMs: number }) => string;
  /** Durable stores historically ignored release failures to avoid masking their critical section. */
  suppressReleaseErrors?: boolean;
  /** Host-supplied filesystem handle; its shape is the implementation's own. */
  filesystem?: Filesystem;
}

export class FileLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly holder: FileLockHolder | undefined;
  readonly waitedMs: number;
  constructor(required: { lockPath: string; holder: FileLockHolder | undefined; waitedMs: number }, optional: { message?: string; messages?: FileLockMessages } = {}) {
    super(optional.message ?? (optional.messages ?? DEFAULT_FILE_LOCK_MESSAGES).fileLockTimeout({ waitedMs: required.waitedMs }));
    this.name = "FileLockTimeoutError"; this.lockPath = required.lockPath; this.holder = required.holder; this.waitedMs = required.waitedMs;
  }
}
export class FileLockLostError extends Error {
  readonly lockPath: string;
  constructor({ lockPath }: { lockPath: string }, { messages = DEFAULT_FILE_LOCK_MESSAGES }: { messages?: FileLockMessages } = {}) {
    super(messages.fileLockLost()); this.name = "FileLockLostError"; this.lockPath = lockPath;
  }
}

export interface FileLockPort<Filesystem = never> {
  withFileLock<T>(required: { lockPath: string; run: (lock: HeldFileLock) => Promise<T> | T }, optional?: FileLockPortOptions<Filesystem>): Promise<T>;
}
