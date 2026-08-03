import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getPresentationSettings,
  PresentationSettingsValidationError,
  setActiveTheme,
} from "../presentation.js";
import { InMemoryPresentationSettingsRepo } from "../repo.memory.js";

const seedSettings = {
  workspaceId: "workspace-1",
  activeThemeId: "paper" as const,
  updatedAt: "2026-04-06T00:00:00.000Z",
};

test("getPresentationSettings returns current theme and available themes", async () => {
  const repo = new InMemoryPresentationSettingsRepo([seedSettings]);

  const result = await getPresentationSettings({
    deps: { repo },
    input: { workspaceId: "workspace-1" },
  });

  assert.equal(result.settings.activeThemeId, "paper");
  assert.deepEqual(result.availableThemeIds, ["paper", "atlas", "glassmorphic"]);
});

test("setActiveTheme updates the active theme", async () => {
  const repo = new InMemoryPresentationSettingsRepo([seedSettings]);
  const clock = { nowIso: () => "2026-04-06T01:00:00.000Z" };

  const result = await setActiveTheme({
    deps: { repo, clock },
    input: { workspaceId: "workspace-1", activeThemeId: "glassmorphic" },
  });

  assert.equal(result.settings.activeThemeId, "glassmorphic");
  assert.equal(result.settings.updatedAt, "2026-04-06T01:00:00.000Z");
});

test("setActiveTheme rejects unsupported themes", async () => {
  const repo = new InMemoryPresentationSettingsRepo([seedSettings]);
  const clock = { nowIso: () => "2026-04-06T01:00:00.000Z" };

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
