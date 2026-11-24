import { expect, test, vi } from "vitest";

import { createVisitorToolsPort, VISITOR_TOOLS_CONFLICT_CODE, VISITOR_TOOLS_NAMESPACE, type AdminRequestOps } from "../visitor-tools.js";

/** L13 Stryker: the port's two calls had no lib-scoped test. Pin method, path, body and unwrap.
 *  The host's authenticated request is injected; the host's own binding pins the API base. */
function stub(data: unknown) {
  const authenticatedAdminRequest = vi.fn(async () => ({ data }));
  const http = { authenticatedAdminRequest } as unknown as AdminRequestOps;
  return { http, authenticatedAdminRequest };
}

test("list GETs the workspace's visitor tools and unwraps data", async () => {
  const view = { revisionSeq: 3, defaults: { perIpPerHour: 1, perSitePerDay: 2 }, callsPerTurn: 1, tools: [] };
  const { http, authenticatedAdminRequest } = stub(view);
  expect(await createVisitorToolsPort({ http, workspaceId: "workspace-local" }).list({})).toEqual(view);
  expect(authenticatedAdminRequest).toHaveBeenCalledWith({ path: "/workspaces/workspace-local/assistant/visitor-tools", method: "GET" });
});

test("configure PUTs the exact patch and unwraps data", async () => {
  const { http, authenticatedAdminRequest } = stub({ revisionSeq: 4 });
  const patch = { toolId: "site", expectedRevisionSeq: 3, mode: "off" as const };
  expect(await createVisitorToolsPort({ http, workspaceId: "ws-2" }).configure(patch)).toEqual({ revisionSeq: 4 });
  expect(authenticatedAdminRequest).toHaveBeenCalledWith({ path: "/workspaces/ws-2/assistant/visitor-tools", method: "PUT", body: patch });
});

test("the conflict code and settings namespace match the server's", () => {
  expect(VISITOR_TOOLS_CONFLICT_CODE).toBe("VISITOR_TOOLS_REVISION_CONFLICT");
  expect(VISITOR_TOOLS_NAMESPACE).toBe("site.assistant");
});
