import { afterEach, expect, test, vi } from "vitest";

/**
 * @file The Postgres test helpers' module-level wiring must not ask the OS for the current user
 * when `PGUSER` already names the role: on a host whose UID has no passwd entry `os.userInfo()`
 * throws, and importing the helpers would then fail before any connection is attempted.
 */

const userInfo = vi.fn(() => {
  throw Object.assign(new Error("uv_os_get_passwd returned ENOENT"), { code: "ERR_SYSTEM_ERROR" });
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, userInfo }, userInfo };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  userInfo.mockClear();
});

test("with PGUSER set, importing the helpers never consults the OS user", async () => {
  vi.stubEnv("PGUSER", "bob");
  await expect(import("../testing/postgres-database.js")).resolves.toBeDefined();
  expect(userInfo).not.toHaveBeenCalled();
});
