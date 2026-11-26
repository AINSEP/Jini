import { describe, expect, it, vi } from "vitest";
import { registerPublishContentPeerPushRoutes, respondWithPeerActionError } from "../publish-content/peer-transport.js";

describe("peer push registration", () => {
  it("preflights every push before resolving a credential", () => {
    const routes: Parameters<Parameters<typeof registerPublishContentPeerPushRoutes>[0]["mount"]>[0][] = [];
    const openPeer = vi.fn();
    registerPublishContentPeerPushRoutes({ mount: entry => { routes.push(entry); }, openPeer, plan: vi.fn(), confirm: vi.fn(), execute: vi.fn(), canPublishToLive: () => false, liveSiteRefusal: { status: 403, body: { code: "LIVE_REFUSED" } }, operation: "host/peer" });
    expect(routes).toHaveLength(3);
    for (const route of routes) expect(route.preflight.check()).toEqual({ status: 403, body: { code: "LIVE_REFUSED" } });
    expect(openPeer).not.toHaveBeenCalled();
  });

  it("reports one unknown incident using the registered template and a safe reply", () => {
    const incident = vi.fn<Parameters<typeof respondWithPeerActionError>[0]["incident"]>(() => ({ status: 500, body: { error: "unavailable", code: "INTERNAL_ERROR" } }));
    const json = vi.fn();
    respondWithPeerActionError({ err: new Error("private credential"), json, incident, operation: "host/peer", method: "POST", route: "/peers/:peerId/push/execute", discloseDetails: false });
    expect(incident).toHaveBeenCalledTimes(1);
    expect(incident.mock.calls[0]?.[1]).toMatchObject({ method: "POST", route: "/peers/:peerId/push/execute" });
    expect(json).toHaveBeenCalledWith({ error: "unavailable", code: "INTERNAL_ERROR" }, 500);
    expect(JSON.stringify(json.mock.calls)).not.toContain("private credential");
  });
});
