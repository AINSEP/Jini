import type { ChildProcess, SpawnOptions } from 'node:child_process';

/**
 * Starts one OS process and returns it in the same synchronous turn. Never a promise: the caller
 * attaches its `'error'` and `'spawn'` listeners before yielding, and an `async` adapter would let
 * the child's first event fire with nobody listening. The return type makes that a compile error.
 */
export type ProcessSpawnPort = (
  required: { readonly command: string; readonly args: readonly string[] },
  optional?: SpawnOptions,
) => ChildProcess;
