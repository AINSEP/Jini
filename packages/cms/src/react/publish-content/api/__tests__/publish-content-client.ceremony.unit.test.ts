import { expect, test, vi } from "vitest";
import { createPublishContentApi } from "../publish-content-api.js";

test("publish plans omit absent filters and execute carries the confirmed overwrite set", async () => {
  const request = vi.fn(async (_input: { path: string }, _options?: { init: { method: string; body?: string } }): Promise<unknown> => ({}));
  const api = createPublishContentApi({ request: <T,>(input: { path: string }, options?: { init: { method: string; body?: string } }) => request(input, options) as Promise<T>, workspaceId: "ws" });
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

test("peer listing uses the workspace collection and returns the destination metadata without writing", async () => {
  const peers = [{ id: "staging", label: "Staging", baseUrl: "https://staging.example", remoteWorkspaceId: "remote", masked: null, hasCredential: false }];
  const request = vi.fn(async (input: { path: string }, options?: { init: { method: string; body?: string } }): Promise<unknown> => {
    expect(input).toEqual({ path: "/workspaces/editor/publish-content/peers" });
    expect(options).toBeUndefined();
    return { peers };
  });
  const api = createPublishContentApi({ workspaceId: "editor", request: <T,>(input: { path: string }, options?: { init: { method: string; body?: string } }) => request(input, options) as Promise<T> });
  await expect(api.listPublishContentPeers()).resolves.toEqual({ peers });
  expect(request).toHaveBeenCalledExactlyOnceWith({ path: "/workspaces/editor/publish-content/peers" }, undefined);
});
