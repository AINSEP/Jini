import { afterEach, expect, test, vi } from "vitest";

/**
 * @file The Postgres test helpers' module-level wiring must not ask the OS for the current user
 * at import time: on a host whose UID has no passwd entry `os.userInfo()` throws.
 * The fixture caller decides when the environment and OS-user port are resolved.
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

test("without PGUSER, importing every helper still leaves OS lookup to its caller", async () => {
  vi.stubEnv("PGUSER", undefined);
  const fixture = await import("../testing/pg-fixture.js");
  const databases = await import("../testing/postgres-database.js");
  const transfer = await import("../testing/transfer-pg-test-db.js");
  expect(fixture.pgFixtureFromEnv).toBeTypeOf("function");
  expect(databases.postgresDatabaseHelpers).toBeTypeOf("function");
  expect(transfer.createTransferPgTestDb).toBeTypeOf("function");
  expect(userInfo).not.toHaveBeenCalled();
});
