import { expect, it, vi } from "vitest";

import { createSettingsApi } from "../settings-api.js";

/**
 * @file The settings/effective read must never reach the host without a `namespace`: the server
 * answers a missing or empty one with a 400, which names no caller. A blank namespace is refused
 * here, before any request, with text that says what was wrong and where to fix it.
 */

const BLANK = "Cannot read settings without a namespace. Pass the settings group to read, for example \"core.language\".";

it("refuses a blank namespace without calling the host request", async () => {
  const authenticatedAdminRequest = vi.fn();
  const api = createSettingsApi({ authenticatedAdminRequest, workspaceId: "w" });
  for (const namespace of ["", "   "]) {
    await expect(api.getSettingsEffective({ namespace })).rejects.toThrow(BLANK);
  }
  expect(authenticatedAdminRequest).not.toHaveBeenCalled();
});

it("reads a normal namespace under the injected workspace", async () => {
  const authenticatedAdminRequest = vi.fn(async () => ({ data: [] })) as unknown as Parameters<typeof createSettingsApi>[0]["authenticatedAdminRequest"];
  const api = createSettingsApi({ authenticatedAdminRequest, workspaceId: "w" });
  await api.getSettingsEffective({ namespace: "core.language" });
  expect(authenticatedAdminRequest as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({ method: "GET", path: "/workspaces/w/settings/effective?namespace=core.language" });
});
