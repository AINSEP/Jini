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
