import { expect, it, vi } from "vitest";
import { PUSH_POLL_WAIT_MS, siteBackupPlanRoute, siteBackupPushRoute, type SiteBackupRouteDeps } from "../site-backups.js";

const context = { id: "operator-3" };
const raw = { body: { planId: "plan-7" }, query: {}, params: { workspaceId: "ws-9" } };

function fixture() {
  const plan = vi.fn<SiteBackupRouteDeps["plan"]>(async () => ({ planned: true, planId: "plan-7" }));
  const push = vi.fn<SiteBackupRouteDeps["push"]>(async () => ({ pushed: false, code: "BUSY", message: "Still uploading." }));
  const isPublishTrusted = vi.fn<SiteBackupRouteDeps["isPublishTrusted"]>(() => false);
  const mapBackupError = vi.fn<SiteBackupRouteDeps["mapBackupError"]>(() => undefined);
  const deps: SiteBackupRouteDeps = { workspaceId: "ws-9", plan, push, isPublishTrusted, mapBackupError };
  return { deps, plan, push, isPublishTrusted, mapBackupError };
}

it("mounts separate buffered, no-store POST routes and sets the backup polling interval", () => {
  expect([siteBackupPlanRoute, siteBackupPushRoute].map(({ method, path, bufferedReply, responseHeaders }) => ({
    method, path, bufferedReply, responseHeaders,
  }))).toEqual(["plan", "push"].map((step) => ({
    method: "post", path: `/api/admin/v1/workspaces/:workspaceId/site-backups/${step}`, bufferedReply: true,
    responseHeaders: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  })));
  expect(PUSH_POLL_WAIT_MS).toBe(1500);
});

it("passes the caller and a default object to the plan service and relays its JSON response", async () => {
  const { deps, plan, push } = fixture();
  const response = await siteBackupPlanRoute.handle({ raw: { ...raw, body: null }, deps, context }, { signal: new AbortController().signal });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await response.json()).toEqual({ planned: true, planId: "plan-7" });
  expect(plan).toHaveBeenCalledExactlyOnceWith({ call: { input: {}, principal: context, signal: expect.any(AbortSignal) } });
  expect(push.mock.calls).toEqual([]);
});

it("passes the plan id to push without letting a disconnected request cancel the job", async () => {
  const { deps, plan, push } = fixture();
  const request = new AbortController();
  request.abort();
  const response = await siteBackupPushRoute.handle({ raw, deps, context }, { signal: request.signal });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ pushed: false, code: "BUSY", message: "Still uploading." });
  expect(push).toHaveBeenCalledTimes(1);
  const [{ call }] = push.mock.calls[0]!;
  expect(call).toMatchObject({ input: { planId: "plan-7" }, principal: { id: "operator-3" } });
  expect(call.signal).not.toBe(request.signal);
  expect(call.signal.aborted).toBe(false);
  expect(plan.mock.calls).toEqual([]);
});

it("refuses a publish-trust principal with plain text before a backup service can run", async () => {
  const { deps, plan, push, isPublishTrusted } = fixture();
  isPublishTrusted.mockReturnValueOnce(true);
  const response = await siteBackupPushRoute.handle({ raw, deps, context }, { signal: new AbortController().signal });
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toBe("Forbidden");
  expect(isPublishTrusted.mock.calls).toEqual([[{ context }]]);
  expect(plan.mock.calls).toEqual([]);
  expect(push.mock.calls).toEqual([]);
});

it("fails closed before publish-trust lookup when the mount omitted the principal", async () => {
  const { deps, isPublishTrusted, plan } = fixture();
  await expect(siteBackupPlanRoute.handle({ raw, deps, context: undefined }, { signal: new AbortController().signal }))
    .rejects.toThrow("site backup route mounted without an authenticated principal");
  expect(isPublishTrusted.mock.calls).toEqual([]);
  expect(plan.mock.calls).toEqual([]);
});

it("relays a mapped service failure but lets an unmapped private error reach the host", async () => {
  const { deps, push, mapBackupError } = fixture();
  const draft = new Error("Plan was revoked");
  const outage = new Error("Private database address");
  push.mockRejectedValueOnce(draft).mockRejectedValueOnce(outage);
  mapBackupError.mockImplementation(({ error }) => error === draft ? { status: 410, body: { code: "PLAN_REVOKED", message: "Make a new plan." } } : undefined);
  const send = () => siteBackupPushRoute.handle({ raw, deps, context }, { signal: new AbortController().signal });
  const response = await send();
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ code: "PLAN_REVOKED", message: "Make a new plan." });
  await expect(send()).rejects.toBe(outage);
  expect(mapBackupError.mock.calls).toEqual([[{ error: draft }], [{ error: outage }]]);
});
