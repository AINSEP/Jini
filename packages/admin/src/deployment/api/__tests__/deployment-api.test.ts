import { describe, expect, it, vi } from "vitest";
import { createDeploymentApi, type DeploymentApiDeps } from "../deployment-api.js";

function setup(etag = "e1") {
  const request = vi.fn(async (_r?: unknown) => ({ targets: [{ id: "t" }] }));
  const authenticatedRequest = vi.fn(async (_r: unknown, o?: { onOk?: (r: { response: Response }) => void }) => {
    o?.onOk?.({ response: new Response("{}", { headers: { ETag: etag } }) });
    return { exists: true, contents: "FROM x" };
  });
  return { request, authenticatedRequest, api: createDeploymentApi({ request: request as never, authenticatedRequest: authenticatedRequest as never, workspaceId: "w1" }) };
}

describe("createDeploymentApi request shapes", () => {
  it("reads the overview and merges the dockerfile ETag header into the body", async () => {
    const { request, authenticatedRequest, api } = setup();
    await api.getDeploymentOverview();
    expect(request.mock.calls[0]?.[0]).toEqual({ path: "/workspaces/w1/system/deployment-overview" });
    expect(await api.getDockerfileSource()).toEqual({ exists: true, contents: "FROM x", etag: "e1" });
    expect(authenticatedRequest.mock.calls[0]![0]).toEqual({ method: "GET", path: "/workspaces/w1/system/dockerfile" });
  });
  it("writes the dockerfile with If-Match and a contents body", async () => {
    const { authenticatedRequest, api } = setup("e2");
    expect(await api.setDockerfileSource({ contents: "c", ifMatch: "e1" })).toMatchObject({ etag: "e2" });
    const [req, opts] = authenticatedRequest.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }];
    expect(req).toEqual({ method: "PUT", path: "/workspaces/w1/system/dockerfile", body: { contents: "c" } });
    expect(opts.headers).toEqual({ "If-Match": "e1" });
  });
  it("previews, triggers, polls and unwraps targets on the publish paths", async () => {
    const { request, api } = setup();
    await api.getPublishPreview({ target: "vercel", fields: { repo: "r" } });
    await api.getPublishStatus();
    expect(await api.getPublishTargets()).toEqual([{ id: "t" }]);
    await api.triggerPublish({ config: { target: "vercel", fields: { repo: "r" } }, projectName: "p", credentialId: "c" });
    await api.triggerPublish({ config: { target: "vercel", fields: {} }, projectName: "p" });
    const calls = request.mock.calls as unknown as [{ path: string }, { init?: RequestInit }?][];
    expect(calls[0]![0].path).toBe("/workspaces/w1/system/publish/preview?repo=r&target=vercel");
    expect(calls[1]![0].path).toBe("/workspaces/w1/system/publish");
    expect(calls[2]![0].path).toBe("/workspaces/w1/system/publish-targets");
    expect(calls[3]![1]!.init!.method).toBe("POST");
    expect(JSON.parse(String(calls[3]![1]!.init!.body))).toEqual({ repo: "r", target: "vercel", projectName: "p", credentialId: "c" });
    expect(JSON.parse(String(calls[4]![1]!.init!.body))).toEqual({ target: "vercel", projectName: "p" });
  });
});

it("does not substitute the request match value when the server omits the Dockerfile revision", async () => {
  // Like the real request: hands `onOk` the response (no ETag header here), then decodes its body.
  const authenticatedRequest: DeploymentApiDeps["authenticatedRequest"] = async (_req, options) => {
    const response = new Response('{"exists":false,"contents":null}');
    options?.onOk?.({ response });
    return response.json();
  };
  const api = createDeploymentApi({
    request: async () => { throw new Error("Only the Dockerfile endpoints are exercised here"); },
    authenticatedRequest,
    workspaceId: "revisionless",
  });
  await expect(api.getDockerfileSource()).resolves.toEqual({ exists: false, contents: null, etag: "" });
  await expect(api.setDockerfileSource({ contents: "FROM scratch", ifMatch: "old" })).resolves.toEqual({ exists: false, contents: null, etag: "" });
});
