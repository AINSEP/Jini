/**
 * @module process
 *
 * OS process lifecycle and stamp primitives: encode/decode `--flag=value`
 * process stamps and match them against a contract, spawn background and logged
 * child processes, probe liveness, enumerate process snapshots (POSIX `ps` /
 * Windows `Get-CimInstance`), walk a process tree, and stop a set of PIDs with
 * SIGTERM-then-SIGKILL escalation.
 *
 * Uses `command` for invocation construction and `shell`'s direct buffered
 * executor for bounded usage samples; keeps a private `errorCode` copy.
 */
import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { windowsPowerShell } from "./windows-system-tools.js";

import type { CommandInvocationRequest, ProcessSnapshot, StopProcessesResult } from "@jini-ai/core/contracts/runtime";
import type { ProcessPrivateMemory, ProcessUsage } from "@jini-ai/core/contracts/site/platform-process";
import { createCommandInvocation } from "./command.js";
import { execFileBuffered } from "./shell.js";
import { topReadings } from "./process-top-footprint.js";
import { listPosixProcessSnapshots, listWindowsProcessSnapshots, parsePsUsage, parseCimUsage, processUsageCommand, processProbeOutput, parsePrivateWorkingSets, assertPrivateMemorySample } from "./process-probes.js";

/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/platform-process`; removed at the next major. */
export type { ProcessPrivateMemory, ProcessUsage } from "@jini-ai/core/contracts/site/platform-process";

export type ProcessStampShape = object;

export type ProcessStampField<TStamp extends ProcessStampShape> = Extract<keyof TStamp, string>;

export type ProcessStampContract<
  TStamp extends ProcessStampShape,
  TCriteria extends Partial<TStamp> = Partial<TStamp>,
> = {
  normalizeStamp(input: unknown): TStamp;
  normalizeStampCriteria(input?: unknown): TCriteria;
  stampFields: readonly ProcessStampField<TStamp>[];
  stampFlags: { readonly [K in ProcessStampField<TStamp>]: string };
};

export type SpawnProcessRequest = CommandInvocationRequest & {
  cwd?: string;
  detached?: boolean;
  logFd?: number | null;
};

export type ProcessUsagePorts = {
  platform?: NodeJS.Platform;
  run?: typeof execFileBuffered;
};

export type ProcessUsageOptions = {
  timeoutMs?: number;
};

export type StampedProcessMatchCriteria<TStamp extends ProcessStampShape> = Partial<TStamp>;

/** @internal Extract a Node `error.code` as a string, or `null` when the value carries no code. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error == null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code == null ? null : String(code);
}

/**
 * Serialize a process stamp into `--flag=value` CLI arguments per the contract.
 * Every stamp field must normalize to a string or an error is thrown.
 *
 * @param stamp - The stamp object to encode.
 * @param contract - The stamp contract providing field list, flags, and normalization.
 * @returns The `--flag=value` argument strings, one per stamp field.
 */
export function createProcessStampArgs<TStamp extends ProcessStampShape>(
  { stamp, contract }: { stamp: TStamp; contract: ProcessStampContract<TStamp> },
  _optional: Record<string, never> = {},
): string[] {
  const normalized = contract.normalizeStamp(stamp);
  return contract.stampFields.map((field) => {
    const value = normalized[field];
    if (typeof value !== "string") {
      throw new Error(`process stamp field ${field} must normalize to a string`);
    }
    return `${contract.stampFlags[field]}=${value}`;
  });
}

/** @internal Split a command line string into whitespace-separated argument tokens. */
function commandArgs(command: string): string[] {
  return command.trim().split(/\s+/).filter((part) => part.length > 0);
}

/**
 * Read the value of a CLI flag from an argument list, supporting both the
 * `--flag value` and inline `--flag=value` forms.
 *
 * @param args - The argument list to search.
 * @param flagName - The flag name (including any leading dashes).
 * @returns The flag's value, or `null` when the flag is absent.
 */
export function readFlagValue({ args, flagName }: { args: readonly string[]; flagName: string }, _optional: Record<string, never> = {}): string | null {
  const inlinePrefix = `${flagName}=`;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === flagName) return args[index + 1] ?? null;
    if (typeof argument === "string" && argument.startsWith(inlinePrefix)) {
      return argument.slice(inlinePrefix.length);
    }
  }
  return null;
}

/**
 * Decode a process stamp from a raw argument list per the contract, returning
 * `null` when normalization fails (e.g. a required field is missing).
 *
 * @param args - The process argument list to read stamp flags from.
 * @param contract - The stamp contract providing field list, flags, and normalization.
 * @returns The decoded stamp, or `null` when it cannot be normalized.
 */
export function readProcessStamp<TStamp extends ProcessStampShape>(
  { args, contract }: { args: readonly string[]; contract: ProcessStampContract<TStamp> },
  _optional: Record<string, never> = {},
): TStamp | null {
  try {
    const input = Object.fromEntries(
      contract.stampFields.map((field) => [field, readFlagValue({ args, flagName: contract.stampFlags[field] })]),
    );
    return contract.normalizeStamp(input);
  } catch {
    return null;
  }
}

/**
 * Decode a process stamp from a full command-line string by tokenizing it first.
 *
 * @param command - The full command line to read stamp flags from.
 * @param contract - The stamp contract providing field list, flags, and normalization.
 * @returns The decoded stamp, or `null` when it cannot be normalized.
 */
export function readProcessStampFromCommand<TStamp extends ProcessStampShape>(
  { command, contract }: { command: string; contract: ProcessStampContract<TStamp> },
  _optional: Record<string, never> = {},
): TStamp | null {
  return readProcessStamp({ args: commandArgs(command), contract });
}

/**
 * Test whether a stamp matches criteria: every criterion field that is set must
 * equal the corresponding normalized stamp field; unset criteria fields match
 * anything.
 *
 * @param stamp - The stamp to test.
 * @param criteria - The partial criteria to match against (undefined matches all).
 * @param contract - The stamp contract providing field list and normalization.
 * @returns `true` when every specified criterion matches the stamp.
 */
export function matchesProcessStamp<TStamp extends ProcessStampShape, TCriteria extends Partial<TStamp> = Partial<TStamp>>(
  { stamp, criteria, contract }: { stamp: TStamp; criteria: TCriteria | undefined; contract: ProcessStampContract<TStamp, TCriteria> },
  _optional: Record<string, never> = {},
): boolean {
  const normalizedStamp = contract.normalizeStamp(stamp);
  const normalizedCriteria = contract.normalizeStampCriteria(criteria ?? {});
  return contract.stampFields.every((field) => {
    const expected = normalizedCriteria[field as keyof TCriteria];
    return expected == null || normalizedStamp[field] === expected;
  });
}

/**
 * Test whether a process snapshot's command line carries a stamp matching the
 * criteria. Combines stamp decoding from the command with `matchesProcessStamp`.
 *
 * @param processInfo - A snapshot exposing at least the `command` string.
 * @param criteria - The partial criteria to match against (undefined matches all).
 * @param contract - The stamp contract providing field list and normalization.
 * @returns `true` when the command carries a decodable stamp that matches.
 */
export function matchesStampedProcess<TStamp extends ProcessStampShape, TCriteria extends Partial<TStamp> = Partial<TStamp>>(
  { processInfo, criteria, contract }: { processInfo: Pick<ProcessSnapshot, "command">; criteria: TCriteria | undefined; contract: ProcessStampContract<TStamp, TCriteria> },
  _optional: Record<string, never> = {},
): boolean {
  const stamp = readProcessStampFromCommand({ command: processInfo.command, contract });
  return stamp != null && matchesProcessStamp({ stamp, criteria, contract });
}

/** @internal Build the stdio triple for a spawned process, routing stdout/stderr to a log fd when provided. */
function createLoggedStdio(logFd?: number | null): StdioOptions {
  return logFd == null ? ["ignore", "ignore", "ignore"] : ["ignore", logFd, logFd];
}

/** @internal Resolve once the child emits `spawn`, or reject on the child's `error` event. */
async function waitForChildSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once("error", rejectSpawn);
    child.once("spawn", resolveSpawn);
  });
}

/**
 * Spawn a detached background process, wait for it to actually start, then
 * `unref` it so the parent can exit independently.
 *
 * @param request - The command/args/env plus cwd, detached, and log-fd options.
 * @returns The spawned child's `{ pid }`.
 * @throws If the child fails to spawn or reports no pid.
 */
export async function spawnBackgroundProcess(request: SpawnProcessRequest): Promise<{ pid: number }> {
  const invocation = createCommandInvocation(request);
  const child = spawn(invocation.command, invocation.args, {
    cwd: request.cwd,
    detached: request.detached ?? true,
    env: request.env,
    stdio: createLoggedStdio(request.logFd),
    windowsHide: process.platform === "win32",
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  await waitForChildSpawn(child);
  if (child.pid == null) throw new Error(`failed to spawn background process: ${invocation.command}`);
  child.unref();
  return { pid: child.pid };
}

/**
 * Spawn a (by default non-detached) child process with stdout/stderr routed to
 * an optional log fd, waiting for it to start before returning the handle.
 *
 * @param request - The command/args/env plus cwd, detached, and log-fd options.
 * @returns The live `ChildProcess` handle.
 * @throws If the child fails to spawn or reports no pid.
 */
export async function spawnLoggedProcess(request: SpawnProcessRequest): Promise<ChildProcess> {
  const invocation = createCommandInvocation(request);
  const child = spawn(invocation.command, invocation.args, {
    cwd: request.cwd,
    detached: request.detached ?? false,
    env: request.env,
    stdio: createLoggedStdio(request.logFd),
    windowsHide: process.platform === "win32",
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  await waitForChildSpawn(child);
  if (child.pid == null) throw new Error(`failed to spawn process: ${invocation.command}`);
  return child;
}

/**
 * Probe whether a process is alive via a signal-0 `process.kill`. Treats
 * `ESRCH` as dead and any other error (e.g. `EPERM`) as alive.
 *
 * @param pid - The PID to probe (non-number values are treated as dead).
 * @returns `true` when the process appears to exist.
 */
export function isProcessAlive(pid: number | null | undefined): boolean {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

/**
 * Poll until a process exits or the timeout elapses.
 *
 * @param pid - The PID to wait on.
 * @param timeoutMs - Maximum time to wait, in milliseconds (default 5000).
 * @returns `true` if the process is gone by the deadline, otherwise `false`.
 */
export async function waitForProcessExit(pid: number | null | undefined, timeoutMs = 5000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

/**
 * Enumerate all running processes as `{ pid, ppid, command }` snapshots, using
 * the platform-appropriate backend. Returns an empty list on any failure.
 *
 * @param input - Optional host platform and bounded execution port.
 * @param options - Probe timeout (5000ms); commandLines=false reads executable names only and
 * preserves nameless Windows identities even when usage diagnostics are unavailable.
 * @returns The current process snapshots (empty on error), capped at 8MiB of probe output.
 * @example await listProcessSnapshots({}, { commandLines: false })
 */
export async function listProcessSnapshots(
  input: ProcessUsagePorts = {},
  options: ProcessUsageOptions & { commandLines?: boolean } = {},
): Promise<ProcessSnapshot[]> {
  try {
    return (input.platform ?? process.platform) === "win32"
      ? await listWindowsProcessSnapshots(input, options)
      : await listPosixProcessSnapshots(input, options);
  } catch {
    return [];
  }
}

/**
 * Sample process RSS and cumulative CPU without reading command lines. Returns
 * [] on command, timeout, buffer or JSON failure. RSS totals may count shared
 * pages more than once; CPU percentages require deltas between samples.
 * @param input - Optional host platform and bounded command-execution port.
 * @param options - Execution timeout (default 5000ms); output is capped at 8MiB.
 */
export async function listProcessUsage(
  input: ProcessUsagePorts = {},
  options: ProcessUsageOptions = {},
): Promise<ProcessUsage[]> {
  const windows = (input.platform ?? process.platform) === "win32";
  const { command, args } = processUsageCommand(windows);
  try {
    const result = await (input.run ?? execFileBuffered)(command, args, {
      encoding: "utf8", timeout: options.timeoutMs ?? 5000, maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    if (!result.ok) return [];
    return windows ? parseCimUsage(result.stdout) : parsePsUsage(result.stdout);
  } catch {
    return [];
  }
}

/**
 * Decode macOS `footprint -p` output into bytes; absent or invalid readings return null.
 * @example parseProcessFootprint({ text: "Footprint: 187 MB" })
 */
export function parseProcessFootprint({ text }: { text: string }, _options = {}): number | null {
  const match = /Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)\b/.exec(text);
  if (!match) return null;
  const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  const bytes = Number(match[1]) * units[match[2]!]!;
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * Read private memory for unique PIDs, without attaching an inspector or changing target state.
 * macOS uses physical footprint; Windows uses private working set joined by PID, never PrivateBytes
 * or Win32_Process.WorkingSetSize. Failed probes return null; invalid PIDs/limits throw RangeError.
 * @param input - Requested PIDs and optional host platform/bounded execution port.
 * @param options - Per-probe timeout (5000ms) and unique-PID limit (512); excess is rejected.
 * @returns Accurately labeled bytes, including a null row for every unavailable PID.
 * @complexity O(n) output space for n unique PIDs; macOS makes one bounded `top` read,
 * Windows makes one bounded bulk probe plus O(m) parsing space for m host processes.
 * @example await sampleProcessPrivateMemory({ pids: [123] }, { timeoutMs: 10000 })
 */
export async function sampleProcessPrivateMemory(
  input: ProcessUsagePorts & { pids: readonly number[] },
  options: ProcessUsageOptions & { maxPids?: number } = {},
): Promise<ProcessPrivateMemory> {
  const pids = [...new Set(input.pids)];
  assertPrivateMemorySample({ pids, maxPids: options.maxPids ?? 512 });
  const platform = input.platform ?? process.platform;
  const run = input.run ?? execFileBuffered;
  if (platform === "darwin") {
    if (!pids.length) return { metric: "physical-footprint", readings: [] };
    const stdout = await processProbeOutput({ command: "/usr/bin/top", args: ["-l","1","-R","-F","-stats","pid,mem", ...pids.flatMap(pid => ["-pid", String(pid)])], run }, options);
    return { metric: "physical-footprint", readings: topReadings({ text: stdout ?? "", pids }) };
  }
  if (platform !== "win32") return { metric: "unavailable", readings: pids.map((pid) => ({ pid, bytes: null })) };
  const stdout = await processProbeOutput({ command: windowsPowerShell(), run, args: ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess, WorkingSetPrivate | ConvertTo-Json -Compress"],
  }, options);
  const byPid = parsePrivateWorkingSets({ stdout });
  return { metric: "private-working-set", readings: pids.map((pid) => ({ pid, bytes: byPid.get(pid) ?? null })) };
}

/** @internal Send a signal to each PID, ignoring `ESRCH` (already-dead) but rethrowing other errors. */
function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (errorCode(error) !== "ESRCH") throw error;
    }
  }
}

/** @internal Poll until all PIDs exit or the timeout elapses; returns the PIDs still alive. */
async function waitForProcessesToExit(pids: number[], timeoutMs = 5000): Promise<number[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const remaining = pids.filter(isProcessAlive);
    if (remaining.length === 0) return [];
    await sleep(100);
  }
  return pids.filter(isProcessAlive);
}

/**
 * Stop a set of PIDs with escalation: SIGTERM, wait, then SIGKILL any
 * survivors. Excludes the current process and de-duplicates the input.
 *
 * @param pids - The PIDs to stop (non-numbers and the current PID are ignored).
 * @returns A result describing matched, stopped, force-killed, and remaining PIDs.
 */
export async function stopProcesses(pids: Array<number | null | undefined>): Promise<StopProcessesResult> {
  const uniquePids = [...new Set(pids)]
    .filter((pid): pid is number => typeof pid === "number" && pid !== process.pid)
    .sort((left, right) => right - left);
  if (uniquePids.length === 0) {
    return { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };
  }
  signalProcesses(uniquePids, "SIGTERM");
  const remainingAfterTerm = await waitForProcessesToExit(uniquePids);
  if (remainingAfterTerm.length === 0) {
    return { alreadyStopped: false, forcedPids: [], matchedPids: uniquePids, remainingPids: [], stoppedPids: uniquePids };
  }
  signalProcesses(remainingAfterTerm, "SIGKILL");
  const remainingAfterKill = await waitForProcessesToExit(remainingAfterTerm);
  const stoppedPids = uniquePids.filter((pid) => !remainingAfterKill.includes(pid));
  return { alreadyStopped: false, forcedPids: remainingAfterTerm, matchedPids: uniquePids, remainingPids: remainingAfterKill, stoppedPids };
}
