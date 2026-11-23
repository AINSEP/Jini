import { expect, test, vi } from "vitest";

import { createAssistantSubagentsPort, SUBAGENT_DANGERS } from "../assistant-subagents.js";
import type { AdminRequestOps } from "../visitor-tools.js";

/** The host's authenticated request is injected; the host's own binding pins the API base. */
test("the subagents port reads and writes the workspace's full-CLI setting with the risk acknowledgement", async () => {
  const settings = { enabled: true, canEdit: true };
  const authenticatedAdminRequest = vi.fn(async () => settings);
  const port = createAssistantSubagentsPort({ http: { authenticatedAdminRequest } as unknown as AdminRequestOps, workspaceId: "ws-9" });
  await expect(port.read({})).resolves.toEqual(settings);
  await expect(port.write({ enabled: true, riskAcknowledged: true })).resolves.toEqual(settings);
  expect(authenticatedAdminRequest.mock.calls).toEqual([
    [{ path: "/workspaces/ws-9/system/assistant-full-cli", method: "GET" }],
    [{ path: "/workspaces/ws-9/system/assistant-full-cli", method: "PUT", body: { enabled: true, riskAcknowledged: true } }],
  ]);
  expect(SUBAGENT_DANGERS[0]).toBe("Security risk: subagents can act independently.");
});
