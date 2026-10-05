import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createPermissionMigrationRegistry } from "../index.js";

test("a fresh migration registry holds the built-in pairs without a side-effect-only import", () => {
  const migrations = new Map(createPermissionMigrationRegistry({}).list({}).map((migration) => [migration.from, migration.to]));
  expect(migrations.get("settings.user.write")).toEqual(["settings.user.read"]);
  expect(migrations.get("media.write")).toEqual(["media.read", "media.upload", "media.update", "media.delete", "media.delete.force", "media.download_original", "media.upload_svg"]);
});

test("every built-in migration retains the captured source order and value", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../core/__tests__/builtins.fixture.json", import.meta.url), "utf8")) as { migrations: unknown };
  expect(createPermissionMigrationRegistry({}).list({})).toEqual(fixture.migrations);
});

test("registries are independent: registering on one never reaches another, and re-registering a from overwrites", () => {
  const hostRegistry = createPermissionMigrationRegistry({});
  hostRegistry.register({ from: "host.old", to: ["host.new"], reason: "first" });
  hostRegistry.register({ from: "host.old", to: ["host.newer"], reason: "second" });
  expect(hostRegistry.list({}).filter((migration) => migration.from === "host.old")).toEqual([{ from: "host.old", to: ["host.newer"], reason: "second" }]);
  expect(createPermissionMigrationRegistry({}).list({}).some((migration) => migration.from === "host.old")).toBe(false);
});

test("optional.migrations seed the registry after the built-ins", () => {
  const extra = { from: "host.seeded", to: ["host.target"], reason: "seeded" };
  const listed = createPermissionMigrationRegistry({}, { migrations: [extra] }).list({});
  expect(listed.at(-1)).toEqual(extra);
  expect(listed.length).toBe(createPermissionMigrationRegistry({}).list({}).length + 1);
});
