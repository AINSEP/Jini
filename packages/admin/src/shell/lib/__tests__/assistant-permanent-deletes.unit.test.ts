import { expect, test, vi } from "vitest";

import { createAssistantPermanentDeletesPort } from "../assistant-permanent-deletes.js";
import type { AdminRequestOps } from "../visitor-tools.js";

/**
 * @file The permanent-deletes port is thin: it must hit its own workspace system path through the
 * injected authenticated request and hand back the server's settings unchanged.
 */
test("the permanent-deletes port reads and writes the workspace policy through the injected request", async () => {
  const settings = { enabled: true, allowedToolIds: ["delete_page"], canEdit: true };
  const authenticatedAdminRequest = vi.fn(async () => settings);
  const port = createAssistantPermanentDeletesPort({ http: { authenticatedAdminRequest } as unknown as AdminRequestOps, workspaceId: "ws-1" });
  await expect(port.read({})).resolves.toEqual(settings);
  const policy = { enabled: true, allowedToolIds: ["delete_page"], riskAcknowledged: true };
  await expect(port.write(policy)).resolves.toEqual(settings);
  expect(authenticatedAdminRequest.mock.calls).toEqual([
    [{ path: "/workspaces/ws-1/system/assistant-permanent-deletes", method: "GET" }],
    [{ path: "/workspaces/ws-1/system/assistant-permanent-deletes", method: "PUT", body: policy }],
  ]);
});
