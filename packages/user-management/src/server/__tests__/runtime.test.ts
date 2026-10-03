import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { listPermissionMigrations } from "../index.js";

test("the server initializes built-in migration metadata without a side-effect-only import", () => {
  const migrations = new Map(listPermissionMigrations({}).map((migration) => [migration.from, migration.to]));
  expect(migrations.get("settings.user.write")).toEqual(["settings.user.read"]);
  expect(migrations.get("media.write")).toEqual(["media.read", "media.upload", "media.update", "media.delete", "media.delete.force", "media.download_original", "media.upload_svg"]);
});

test("every built-in migration retains the captured source order and value", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../core/__tests__/builtins.fixture.json", import.meta.url), "utf8")) as { migrations: unknown };
  expect(listPermissionMigrations({})).toEqual(fixture.migrations);
});
