import { afterEach, beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({ readFileSync: vi.fn<(file: string, encoding: string) => string>(), execFileSync: vi.fn<(file: string, args: string[], options: object) => string>() }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: { ...actual, readFileSync: native.readFileSync } };
});
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: native.execFileSync }));

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform): void { Object.defineProperty(process, "platform", { value: platform, configurable: true }); }
async function freshRead(): Promise<ReturnType<typeof import("../boot-identity.js")["readBootIdentity"]>> {
  const { readBootIdentity } = await import("../boot-identity.js");
  return readBootIdentity({});
}
function linuxFiles({ bootId, stat }: { bootId: string; stat: string }): void {
  native.readFileSync.mockImplementation(file => {
    if (file === "/proc/sys/kernel/random/boot_id") return bootId;
    if (file === "/proc/stat") return stat;
    throw new Error(`unexpected read ${file}`);
  });
}
beforeEach(() => { vi.resetModules(); native.readFileSync.mockReset(); native.execFileSync.mockReset(); });
afterEach(() => { onPlatform(realPlatform); });

test("Linux identity combines the kernel boot id with /proc/stat btime in milliseconds", async () => {
  onPlatform("linux"); linuxFiles({ bootId: " 1234-abcd \n", stat: "cpu 1 2 3\nbtime 1700000000\nprocesses 9\n" });
  expect(await freshRead()).toEqual({ id: "1234-abcd", startedAtMs: 1_700_000_000_000 });
  expect(native.execFileSync).not.toHaveBeenCalled();
});
test("Linux identity is unknown when btime is absent", async () => {
  onPlatform("linux"); linuxFiles({ bootId: "1234-abcd", stat: "cpu 1 2 3\n" });
  expect(await freshRead()).toBeUndefined();
});
test("Linux identity is unknown when the boot id is blank", async () => {
  onPlatform("linux"); linuxFiles({ bootId: " \n", stat: "btime 1700000000\n" });
  expect(await freshRead()).toBeUndefined();
});
test("Linux read failure (e.g. EACCES) is unknown identity, not an error", async () => {
  onPlatform("linux"); native.readFileSync.mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
  expect(await freshRead()).toBeUndefined();
});
test("macOS identity parses kern.boottime sec through a bounded sysctl call", async () => {
  onPlatform("darwin"); native.execFileSync.mockReturnValue("{ sec = 1700000123, usec = 456 } Tue Nov 14 22:15:23 2023\n");
  expect(await freshRead()).toEqual({ id: "1700000123000", startedAtMs: 1_700_000_123_000 });
  expect(native.execFileSync).toHaveBeenCalledWith("/usr/sbin/sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 3000 });
  expect(native.readFileSync).not.toHaveBeenCalled();
});
test("macOS identity is unknown when sysctl output has no sec field", async () => {
  onPlatform("darwin"); native.execFileSync.mockReturnValue("garbage");
  expect(await freshRead()).toBeUndefined();
});
test("Windows identity parses the UTC LastBootUpTime through a hidden, bounded PowerShell call", async () => {
  onPlatform("win32"); native.execFileSync.mockReturnValue("2023-11-14T22:15:23.0000000Z\r\n");
  expect(await freshRead()).toEqual({ id: String(Date.parse("2023-11-14T22:15:23Z")), startedAtMs: Date.parse("2023-11-14T22:15:23Z") });
  expect(native.execFileSync).toHaveBeenCalledWith("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"],
    { encoding: "utf8", timeout: 3000, windowsHide: true });
});
test("Windows identity is unknown when PowerShell output is not a date", async () => {
  onPlatform("win32"); native.execFileSync.mockReturnValue("Get-CimInstance : Access denied\r\n");
  expect(await freshRead()).toBeUndefined();
});
test("Windows PowerShell timeout/failure is unknown identity, not an error", async () => {
  onPlatform("win32"); native.execFileSync.mockImplementation(() => { throw Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT" }); });
  expect(await freshRead()).toBeUndefined();
});
test("other platforms report unknown identity without any OS call", async () => {
  onPlatform("freebsd");
  expect(await freshRead()).toBeUndefined();
  expect(native.execFileSync).not.toHaveBeenCalled();
  expect(native.readFileSync).not.toHaveBeenCalled();
});
test("a known identity is read once per process and then served from cache", async () => {
  onPlatform("darwin"); native.execFileSync.mockReturnValue("{ sec = 5, usec = 0 }");
  const { readBootIdentity } = await import("../boot-identity.js");
  expect(readBootIdentity({})).toEqual({ id: "5000", startedAtMs: 5000 });
  native.execFileSync.mockReturnValue("{ sec = 9, usec = 0 }");
  expect(readBootIdentity({})).toEqual({ id: "5000", startedAtMs: 5000 });
  expect(native.execFileSync).toHaveBeenCalledTimes(1);
});
test("an unknown identity is also cached so failing OS calls are not retried", async () => {
  onPlatform("win32"); native.execFileSync.mockImplementation(() => { throw new Error("denied"); });
  const { readBootIdentity } = await import("../boot-identity.js");
  expect(readBootIdentity({})).toBeUndefined();
  native.execFileSync.mockReturnValue("2023-11-14T22:15:23Z");
  expect(readBootIdentity({})).toBeUndefined();
  expect(native.execFileSync).toHaveBeenCalledTimes(1);
});
