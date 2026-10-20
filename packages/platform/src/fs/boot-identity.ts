import fs from "node:fs";
import { execFileSync } from "node:child_process";

export interface BootIdentity { id: string; startedAtMs: number; }
let cached: BootIdentity | null | undefined;
/** Kernel boot identity distinguishes a recycled PID across reboots. Unknown identity fails safe
 * to the existing liveness probe; no age timeout is used to evict a potentially live owner.
 * Native calls are bounded and cached once per process. @complexity O(1) bounded OS reads.
 */
export function readBootIdentity(_required: Record<string, never>, _options = {}): BootIdentity | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = null;
  try {
    let startedAtMs: number;
    if (process.platform === "linux") {
      const id = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      startedAtMs = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf8"))?.[1]) * 1000;
      if (id && Number.isFinite(startedAtMs)) cached = { id, startedAtMs };
    } else {
      const text = process.platform === "darwin"
        ? execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 3000 })
        : process.platform === "win32"
          ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], { encoding: "utf8", timeout: 3000, windowsHide: true })
          : "";
      startedAtMs = process.platform === "darwin" ? Number(/sec\s*=\s*(\d+)/.exec(text)?.[1]) * 1000 : Date.parse(text.trim());
      if (Number.isFinite(startedAtMs)) cached = { id: String(startedAtMs), startedAtMs };
    }
  } catch { /* Permission/OS failure is unknown identity, never proof of death. */ }
  return cached ?? undefined;
}

/** Darwin/Windows identities are wall-clock boot times the OS re-derives when it steps the clock, so
 * processes that cached the same boot at different times can disagree by seconds (kern.boottime drops
 * usec, so a sub-second step flips the id). Exact comparison let a long-lived observer delete a live
 * owner's lease. Two real boots are separated by the earlier boot's uptime plus a restart, so only a gap
 * beyond this tolerance proves an earlier boot; shorter gaps fall back to the PID probe.
 */
export const BOOT_CLOCK_TOLERANCE_MS = 10 * 60_000;
/** True only when a recorded holder provably predates this boot. Linux boot_id is a random UUID and is
 * compared exactly; numeric (time-derived) ids and legacy timestamps get the tolerance above. A record
 * from a "later" boot is clock skew, never proof of death. @complexity O(1).
 */
export function fromEarlierBoot({ boot, bootId, atMs }: { boot: BootIdentity | undefined; bootId: string | undefined; atMs: number }, _options = {}): boolean {
  if (!boot) return false;
  const recordedAtMs = bootId === undefined ? atMs : /^\d+$/.test(bootId) ? Number(bootId) : undefined;
  return recordedAtMs === undefined ? bootId !== boot.id : recordedAtMs < boot.startedAtMs - BOOT_CLOCK_TOLERANCE_MS;
}
