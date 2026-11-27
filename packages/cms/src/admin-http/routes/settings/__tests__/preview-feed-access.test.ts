import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { expect, it, vi } from "vitest";
import { authorizeChangeFeed } from "../preview-feed-access.js";

const identity = { principalId: "editor-7", workspaceId: "garden-9" };
const settingsRequest = { ...identity, permission: "settings.read", entityType: "setting-value" };
const previewRequest = { ...identity, permission: "theme.set", entityType: "theme" };

it("does not ask for theme rights when the subscriber only requested settings", async () => {
  const authorize = vi.fn<AuthorizeFn>().mockResolvedValueOnce({ allowed: true, reason: "settings grant" });
  await expect(authorizeChangeFeed({ authorize, ...identity, includePreview: false }))
    .resolves.toEqual({ settings: true, preview: false, reason: "settings grant" });
  expect(authorize.mock.calls).toEqual([[settingsRequest]]);
});

it.each([
  { settings: false, preview: true },
  { settings: true, preview: false },
])("keeps the feed grants independent (settings=$settings, preview=$preview)", async ({ settings, preview }) => {
  const authorize = vi.fn<AuthorizeFn>()
    .mockResolvedValueOnce({ allowed: settings, reason: "settings policy" })
    .mockResolvedValueOnce({ allowed: preview, reason: "theme policy" });
  await expect(authorizeChangeFeed({ authorize, ...identity, includePreview: true }))
    .resolves.toEqual({ settings, preview, reason: "settings policy" });
  expect(authorize.mock.calls).toEqual([[settingsRequest], [previewRequest]]);
});
