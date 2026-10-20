import fs from "node:fs";
import { execFileSync } from "node:child_process";

export interface BootIdentity { id: string; startedAtMs: number; }
let cached: BootIdentity | null | undefined;
const NATIVE_TIMEOUT_MS = 3000;
function linuxBootIdentity(): BootIdentity | null {
  const id = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const startedAtMs = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf8"))?.[1]) * 1000;
  return id && Number.isFinite(startedAtMs) ? { id, startedAtMs } : null;
}
/** Platforms without a kernel boot id use the boot timestamp itself as the identity. */
function timestampIdentity(startedAtMs: number): BootIdentity | null {
  return Number.isFinite(startedAtMs) ? { id: String(startedAtMs), startedAtMs } : null;
}
function darwinBootIdentity(): BootIdentity | null {
  const text = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: NATIVE_TIMEOUT_MS });
  return timestampIdentity(Number(/sec\s*=\s*(\d+)/.exec(text)?.[1]) * 1000);
}
function windowsBootIdentity(): BootIdentity | null {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], { encoding: "utf8", timeout: NATIVE_TIMEOUT_MS, windowsHide: true });
  return timestampIdentity(Date.parse(text.trim()));
}
const PLATFORM_READERS: Partial<Record<NodeJS.Platform, () => BootIdentity | null>> = { linux: linuxBootIdentity, darwin: darwinBootIdentity, win32: windowsBootIdentity };
/** Kernel boot identity distinguishes a recycled PID across reboots. Unknown identity fails safe
 * to the existing liveness probe; no age timeout is used to evict a potentially live owner.
 * Native calls are bounded and cached once per process. @complexity O(1) bounded OS reads.
 */
export function readBootIdentity(_required: Record<string, never>, _options = {}): BootIdentity | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = null;
  try { cached = PLATFORM_READERS[process.platform]?.() ?? null; }
  catch { /* Permission/OS failure is unknown identity, never proof of death. */ }
  return cached ?? undefined;
}
