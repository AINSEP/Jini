import { expect, test, vi } from "vitest";
import { createPublishContentApi } from "../publish-content-api.js";

test("publish plans omit absent filters and execute carries the confirmed overwrite set", async () => {
  const request = vi.fn(async <T,>(_input: { path: string }, _options?: { init: { method: string; body?: string } }): Promise<T> => ({} as T));
  const api = createPublishContentApi({ request, workspaceId: "ws" });
  await api.planPublishContent({ peerId: "peer /" }, {});
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/publish-content/peers/peer%20%2F/push/plan" }, { init: { method: "POST" } });
  await api.planPublishContent({ peerId: "peer /", selectedEntityKeys: [], overwriteEntityKeys: ["post:p"] }, {});
  expect(request.mock.calls.at(-1)?.[1]?.init.body).toBe(JSON.stringify({ selectedEntityKeys: [], overwriteEntityKeys: ["post:p"] }));
  await api.confirmPublishContent({ peerId: "peer /", planId: "plan", planHash: "hash" });
  expect(request.mock.calls.at(-1)?.[1]?.init.body).toBe(JSON.stringify({ planId: "plan", planHash: "hash" }));
  await api.executePublishContent({ peerId: "peer /", bundleId: "bundle", confirmationToken: "token", overwriteEntityKeys: ["post:p"] });
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/publish-content/peers/peer%20%2F/push/execute" }, { init: { method: "POST", body: JSON.stringify({ bundleId: "bundle", confirmationToken: "token", overwriteEntityKeys: ["post:p"] }) } });
  await api.connectPublishDestination();
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/publish-content/destination/connect" }, { init: { method: "POST", body: "{}" } });
});
