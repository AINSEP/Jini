import { posix, win32 } from "node:path";
import { captureLineTail } from "@jini-ai/core/text";
import type { ProcessSnapshot } from "@jini-ai/core/contracts/runtime";
import { windowsPowerShell } from "./windows-system-tools.js";
import { execFileBuffered } from "./shell.js";
import type { ProcessUsagePorts, ProcessUsageOptions } from "./process.js";
import type { ProcessUsage } from "@jini-ai/core/contracts/site/platform-process";

type WindowsProcessRecord = {
  CommandLine?: string | null;
  Name?: string | null;
  ParentProcessId?: number | string | null;
  ProcessId?: number | string | null;
};
/** @internal Parse `ps -axo pid=,ppid=,command=` output into process snapshots. */
function parsePsOutput(stdout: string): ProcessSnapshot[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      // Same as /^\s*(\d+)\s+(\d+)\s+(.+)$/, split so the command tail cannot backtrack.
      const match = /^\s*(\d+)\s+(\d+)/.exec(line);
      const command = match ? captureLineTail({ rest: line.slice(match[0].length) }, { minWhitespace: 1 }) : null;
      if (!match || command === null) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command };
    })
    .filter((snapshot): snapshot is ProcessSnapshot => snapshot != null);
}

/** @internal Enumerate process snapshots on POSIX via `ps`. */
export async function listPosixProcessSnapshots(input: ProcessUsagePorts, options: ProcessUsageOptions & { commandLines?: boolean }): Promise<ProcessSnapshot[]> {
  // Fixed process-enumeration utility intentionally uses the trusted host PATH; command and argv are code-owned.
  const stdout = await processProbeOutput({ command: "ps", run: input.run ?? execFileBuffered,
    args: ["-axo", options.commandLines === false ? "pid=,ppid=,comm=" : "pid=,ppid=,command="],
  }, options);
  return parsePsOutput(stdout ?? "");
}

/** @internal Enumerate process snapshots on Windows via `Get-CimInstance Win32_Process` JSON. */
export async function listWindowsProcessSnapshots(input: ProcessUsagePorts, options: ProcessUsageOptions & { commandLines?: boolean }): Promise<ProcessSnapshot[]> {
  const field = options.commandLines === false ? "Name" : "CommandLine";
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ${field} | ConvertTo-Json -Compress`,
  ].join("; ");
  const stdout = await processProbeOutput({ command: windowsPowerShell(), run: input.run ?? execFileBuffered,
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
  }, options);
  const payload = stdout?.trim();
  if (!payload) return [];
  const records = JSON.parse(payload) as WindowsProcessRecord | WindowsProcessRecord[];
  return (Array.isArray(records) ? records : [records])
    .map((record) => {
      const pid = Number(record.ProcessId);
      const ppid = Number(record.ParentProcessId);
      const commandLine = options.commandLines === false ? record.Name?.trim() ?? "" : record.CommandLine?.trim();
      if (commandLine == null || Number.isNaN(pid) || Number.isNaN(ppid)) return null;
      if (options.commandLines !== false && !commandLine) return null;
      return { command: commandLine, pid, ppid };
    })
    .filter((snapshot): snapshot is ProcessSnapshot => snapshot != null);
}
/** @internal Decode ps cumulative CPU time, including macOS fractional seconds and days. */
function parseCpuTime(value: string): number {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return NaN;
  return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
    + Number(match[3]) * 60 + Number(match[4]);
}

/** @internal Reject incomplete metrics instead of presenting missing usage as zero. */
function validProcessUsage(usage: ProcessUsage): boolean {
  const { pid, ppid, rssBytes, cpuSeconds } = usage;
  return [pid, ppid].every(Number.isSafeInteger) && [rssBytes, cpuSeconds].every(Number.isFinite)
    && [pid, ppid, rssBytes, cpuSeconds].every((value) => value >= 0);
}

/** @internal Read only comm, never args/command, so credentials cannot enter the result. */
export function parsePsUsage(stdout: string): ProcessUsage[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S.*)$/);
    if (!match) return [];
    const usage = {
      pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024,
      cpuSeconds: parseCpuTime(match[4]!), name: posix.basename(match[5]!.trim()),
    };
    return validProcessUsage(usage) ? [usage] : [];
  });
}

/** @internal CIM serializes numeric fields as numbers or strings; null is not zero usage. */
function cimNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" && value.trim() ? Number(value) : NaN;
}

/** @internal Convert Windows 100ns CPU counters and retain nameless process rows. */
export function parseCimUsage(stdout: string): ProcessUsage[] {
  if (!stdout.trim()) return [];
  const payload: unknown = JSON.parse(stdout);
  return (Array.isArray(payload) ? payload : [payload]).flatMap((record: unknown) => {
    if (!record || typeof record !== "object") return [];
    const row = record as Record<string, unknown>;
    const usage = {
      pid: cimNumber(row.ProcessId), ppid: cimNumber(row.ParentProcessId),
      rssBytes: cimNumber(row.WorkingSetSize),
      cpuSeconds: (cimNumber(row.UserModeTime) + cimNumber(row.KernelModeTime)) / 10_000_000,
      name: typeof row.Name === "string" ? win32.basename(row.Name.trim()) : "",
    };
    return validProcessUsage(usage) ? [usage] : [];
  });
}

/** @internal Fixed executable and argv, invoked directly without a command shell. */
export function processUsageCommand(windows: boolean): { command: string; args: string[] } {
  return windows
    ? { command: windowsPowerShell(), args: ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, UserModeTime, KernelModeTime, Name | ConvertTo-Json -Compress"] }
    : { command: "ps", args: ["-axo", "pid=,ppid=,rss=,time=,comm="] };
}
/** @internal One bounded read-only OS probe; partial output on failure is discarded. */
export async function processProbeOutput(
  input: { command: string; args: string[]; run: typeof execFileBuffered },
  options: ProcessUsageOptions,
): Promise<string | null> {
  try {
    const result = await input.run(input.command, input.args, {
      encoding: "utf8", timeout: options.timeoutMs ?? 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
    return result.ok ? result.stdout : null;
  } catch { return null; }
}

/** @internal Performance instance names can reorder (node, node#1); only IDProcess is identity. */
export function parsePrivateWorkingSets({ stdout }: { stdout: string | null }): Map<number, number | null> {
  const readings = new Map<number, number | null>();
  try {
    const payload: unknown = JSON.parse(stdout ?? "null");
    for (const record of Array.isArray(payload) ? payload : [payload]) {
      if (!record || typeof record !== "object") continue;
      const row = record as Record<string, unknown>;
      const pid = cimNumber(row.IDProcess);
      const bytes = cimNumber(row.WorkingSetPrivate);
      if (!validSamplePid(pid)) continue;
      readings.set(pid, Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null);
    }
  } catch { /* Malformed/absent counters are unavailable, never zero. */ }
  return readings;
}

const validSamplePid = (pid: number): boolean => Number.isSafeInteger(pid) && pid > 0;

/** @internal Reject invalid identities and oversized collections before making any OS calls. */
export function assertPrivateMemorySample({ pids, maxPids }: { pids: number[]; maxPids: number }): void {
  if (!pids.every(validSamplePid)) throw new RangeError("invalid process PID");
  if (!Number.isSafeInteger(maxPids) || maxPids < 1 || pids.length > maxPids) throw new RangeError("process sample exceeds PID limit");
}
