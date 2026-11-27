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

it("writes the scoped value and principal as one PUT body", async () => {
  const saved = { data: { key: "locale", valueJson: "fr-CA" } };
  const request = vi.fn(async () => saved);
  const api = createSettingsApi({
    authenticatedAdminRequest: request as unknown as Parameters<typeof createSettingsApi>[0]["authenticatedAdminRequest"],
    workspaceId: "workspace-team",
  });
  const input = { namespace: "core.language", key: "locale", scope: "user", valueJson: "fr-CA" } as const;
  await expect(api.setSetting(input, { principalId: "operator 7" })).resolves.toEqual(saved);
  await expect(api.setSetting({ ...input, scope: "workspace" })).resolves.toEqual(saved);
  expect(request.mock.calls).toEqual([
    [{ method: "PUT", path: "/workspaces/workspace-team/settings/value", body: { ...input, principalId: "operator 7" } }],
    [{ method: "PUT", path: "/workspaces/workspace-team/settings/value", body: { ...input, scope: "workspace" } }],
  ]);
});

it("does not share effective settings reads across principals within the same workspace", async () => {
  const choices = {
    alice: { data: [{ key: "locale", value: "fr", sourceLayer: "user", defVersion: 1 }] },
    bob: { data: [{ key: "locale", value: "de", sourceLayer: "user", defVersion: 1 }] },
  };
  const request = vi.fn(async ({ path, method }: { path: string; method: string }) => {
    if (method !== "GET") throw new Error("Only effective settings reads are scripted");
    if (path === "/workspaces/shared/settings/effective?namespace=core.language&principalId=alice%2Bops") return choices.alice;
    if (path === "/workspaces/shared/settings/effective?namespace=core.language&principalId=bob+ops") return choices.bob;
    throw new Error(`Unexpected settings path: ${path}`);
  });
  const api = createSettingsApi({
    workspaceId: "shared", authenticatedAdminRequest: request as unknown as Parameters<typeof createSettingsApi>[0]["authenticatedAdminRequest"],
  });
  const [alice, bob] = await Promise.all([
    api.getSettingsEffective({ namespace: "core.language" }, { principalId: "alice+ops" }),
    api.getSettingsEffective({ namespace: "core.language" }, { principalId: "bob ops" }),
  ]);
  expect(alice).toEqual(choices.alice);
  expect(bob).toEqual(choices.bob);
  expect(request).toHaveBeenCalledTimes(2);
});
