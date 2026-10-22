import { expect, it } from "vitest";
import * as settings from "@jini-ai/core/settings";
import * as settingsExpress from "@jini-ai/core/settings/express";
import { ToolPermissionDeniedError, adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import * as legacySettings from "../settings/index.js";
import * as legacyExpress from "../settings/express/index.js";
import { ForbiddenError } from "../core/commands/command.js";
import * as legacyPermissions from "../core/tools/args.js";

it("keeps every settings compatibility export identical to its core owner", () => {
  // Identity matters for caches, error instanceof checks and revision/write service wiring.
  expect(Object.keys(legacySettings).sort()).toEqual(Object.keys(settings).sort());
  for (const key of Object.keys(settings)) expect(Reflect.get(legacySettings, key)).toBe(Reflect.get(settings, key));
  expect(Object.keys(legacyExpress).sort()).toEqual(Object.keys(settingsExpress).sort());
  for (const key of Object.keys(settingsExpress)) expect(Reflect.get(legacyExpress, key)).toBe(Reflect.get(settingsExpress, key));
});

it("preserves permission denial identity, exact message and entity scope across CMS and core", async () => {
  expect(ForbiddenError).toBe(ToolPermissionDeniedError);
  expect(ForbiddenError.name).toBe("ForbiddenError");
  expect(legacyPermissions.requireToolPermission).toBe(requireToolPermission);
  expect(legacyPermissions.adaptLegacyAuthorize).toBe(adaptLegacyAuthorize);
  const requests: unknown[] = [];
  const authorize = adaptLegacyAuthorize({ authorize: async request => {
    requests.push(request);
    return { allowed: false, reason: "no_grant" };
  } });
  const denied = requireToolPermission({ authorize, principalId: "caller", workspaceId: "workspace", permission: "settings.read" }, { entityType: "setting-value" });
  await expect(denied).rejects.toBeInstanceOf(ForbiddenError);
  await expect(denied).rejects.toMatchObject({
    message: "principal 'caller' is not authorized for 'settings.read' (no_grant)",
    permission: "settings.read", reason: "no_grant",
  });
  expect(requests).toEqual([{ principalId: "caller", workspaceId: "workspace", permission: "settings.read", entityType: "setting-value" }]);
});
