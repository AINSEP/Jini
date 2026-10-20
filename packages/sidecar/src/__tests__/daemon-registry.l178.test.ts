import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readLiveDaemonRegistryRecord } from "../daemon-registry.js";

const directories: string[] = [];
const record = { url: "http://127.0.0.1:9000", host: "127.0.0.1", port: 9000,
  pid: process.pid, startedAt: "2026-10-20T00:00:00Z" };

async function registryFile({ value }: { value: unknown }, _options: Record<string, never> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "registry-l178-"));
  directories.push(directory);
  const registryPath = join(directory, "daemon.json");
  await writeFile(registryPath, JSON.stringify(value));
  return { registryPath };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test.each([
  null, false, 42, "record", [], {},
  ...["url", "host", "startedAt"].flatMap((field) => [
    { ...record, [field]: null }, { ...record, [field]: "" }, { ...record, [field]: 42 },
  ]),
  ...["port", "pid"].flatMap((field) => [
    { ...record, [field]: null }, { ...record, [field]: "1" },
    { ...record, [field]: 0 }, { ...record, [field]: -1 }, { ...record, [field]: 1.5 },
  ]),
])("rejects malformed registry data before probing a process: %j", async (value) => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  expect(await readLiveDaemonRegistryRecord(await registryFile({ value }))).toBeNull();
  expect(kill).not.toHaveBeenCalled();
});

test("accepts positive integer boundaries and returns additional record fields", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const value = { ...record, port: 1, pid: 1, extra: "retained" };
  expect(await readLiveDaemonRegistryRecord(await registryFile({ value }))).toEqual(value);
  expect(kill).toHaveBeenCalledTimes(1);
  expect(kill).toHaveBeenCalledWith(1, 0);
});

test("accepts unvalidated endpoint and timestamp strings and an out-of-range port (reported, not fixed)", async () => {
  vi.spyOn(process, "kill").mockReturnValue(true);
  const value = { ...record, url: "https://external.example", host: " ", port: 65536, startedAt: "not-a-date" };
  expect(await readLiveDaemonRegistryRecord(await registryFile({ value }))).toEqual(value);
});
