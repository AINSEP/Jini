import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getPresentationSettings,
  PresentationSettingsNotFoundError,
  PresentationSettingsValidationError,
  setActiveTheme,
} from "../presentation.js";
import { InMemoryPresentationSettingsRepo } from "../repo.memory.js";
import * as entry from "../index.js";

const seedSettings = {
  workspaceId: "workspace-1",
  activeThemeId: "paper" as const,
  updatedAt: "2026-04-06T00:00:00.000Z",
};

test("getPresentationSettings returns current theme and available themes", async () => {
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [seedSettings] });

  const result = await getPresentationSettings({
    deps: { repo },
    input: { workspaceId: "workspace-1" },
  });

  assert.equal(result.settings.activeThemeId, "paper");
  assert.deepEqual(result.availableThemeIds, ["paper", "atlas", "glassmorphic"]);
});

test("setActiveTheme updates the active theme", async () => {
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [seedSettings] });
  const clock = { nowMs: () => Date.parse("2026-04-06T01:00:00.000Z")};

  const result = await setActiveTheme({
    deps: { repo, clock },
    input: { workspaceId: "workspace-1", activeThemeId: "glassmorphic" },
  });

  assert.equal(result.settings.activeThemeId, "glassmorphic");
  assert.equal(result.settings.updatedAt, "2026-04-06T01:00:00.000Z");
});

test("setActiveTheme rejects unsupported themes", async () => {
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [seedSettings] });
  const clock = { nowMs: () => Date.parse("2026-04-06T01:00:00.000Z")};

  await assert.rejects(
    () =>
      setActiveTheme({
        deps: { repo, clock },
        input: {
          workspaceId: "workspace-1",
          activeThemeId: "broken" as "paper",
        },
      }),
    PresentationSettingsValidationError
  );
});

test("the presentation entry exports the service, errors and in-memory adapter from their owning modules", () => {
  assert.equal(entry.getPresentationSettings, getPresentationSettings);
  assert.equal(entry.setActiveTheme, setActiveTheme);
  assert.equal(entry.InMemoryPresentationSettingsRepo, InMemoryPresentationSettingsRepo);
  assert.equal(entry.PresentationSettingsNotFoundError, PresentationSettingsNotFoundError);
  assert.deepEqual([...entry.ALLOWED_THEME_IDS], ["paper", "atlas", "glassmorphic"]);
});

test("a workspace with no presentation row is reported as not found on read and on write, and nothing is created", async () => {
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [seedSettings] });
  const notFound = (error: unknown) => error instanceof PresentationSettingsNotFoundError
    && error.message === "presentation settings for workspace 'workspace-2' were not found";
  await assert.rejects(getPresentationSettings({ deps: { repo }, input: { workspaceId: "workspace-2" } }), notFound);
  await assert.rejects(setActiveTheme({ deps: { repo, clock: { nowMs: () => 0 } }, input: { workspaceId: "workspace-2", activeThemeId: "atlas" } }), notFound);
  assert.deepEqual(await repo.listAll(), [seedSettings]);
});

test("InMemoryPresentationSettingsRepo.save inserts a new workspace row and replaces an existing one", async () => {
  const repo = new InMemoryPresentationSettingsRepo({});
  await repo.save(seedSettings);
  await repo.save({ ...seedSettings, workspaceId: "workspace-2" });
  await repo.save({ ...seedSettings, activeThemeId: "atlas" });
  assert.deepEqual(await repo.listAll(), [{ ...seedSettings, activeThemeId: "atlas" }, { ...seedSettings, workspaceId: "workspace-2" }]);
});
