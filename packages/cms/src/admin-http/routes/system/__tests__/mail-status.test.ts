import { describe, expect, it } from "vitest";
import { mailStatusRoute, type MailStatusRouteDeps } from "../mail-status.js";
import { PRINCIPAL, raw, recordingAuthorize, signal } from "./mail-test-helpers.js";

function makeDeps(overrides: Partial<MailStatusRouteDeps> = {}): MailStatusRouteDeps & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    workspaceId: "ws-mail",
    isMailDeliveryAvailable: () => true,
    mailStatus: async (optional) => { asked.push(optional); return { state: "ready" }; },
    asked,
    ...overrides,
  };
}

describe("mailStatusRoute", () => {
  it("keeps the method, path and status, with no body cap of its own", () => {
    expect(mailStatusRoute.method).toBe("get");
    expect(mailStatusRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/system/mail-status");
    expect(mailStatusRoute.successStatus).toBeUndefined();
    expect(mailStatusRoute.maxBodyBytes).toBeUndefined();
  });

  it.each([["1", true], ["true", true], [undefined, false], ["0", false], ["false", false], ["yes", false], [1, false]])(
    "parses ?refresh=%s as refresh %s", (value, refresh) => {
      expect(mailStatusRoute.parse(raw({ query: { refresh: value } }))).toEqual({ ok: true, value: { refresh } });
    },
  );

  it("authorizes admin.forms.manage on the mail entity type, with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await mailStatusRoute.handle({ input: { refresh: false }, deps: makeDeps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.forms.manage", entityType: "mail" }]);
  });

  it("answers delivery availability with the status block spread after it", async () => {
    const { authorize } = recordingAuthorize();
    const deps = makeDeps({ isMailDeliveryAvailable: () => false });
    const result = await mailStatusRoute.handle({ input: { refresh: false }, deps, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { mailDeliveryAvailable: false, state: "ready" } });
  });

  it("answers only availability when the status source reports nothing", async () => {
    const { authorize } = recordingAuthorize();
    const deps = makeDeps({ mailStatus: async () => ({}) });
    const result = await mailStatusRoute.handle({ input: { refresh: false }, deps, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { mailDeliveryAvailable: true } });
  });

  it("hands the refresh flag to the status source", async () => {
    const { authorize } = recordingAuthorize();
    const deps = makeDeps();
    await mailStatusRoute.handle({ input: { refresh: true }, deps, context: PRINCIPAL, authorize });
    await mailStatusRoute.handle({ input: { refresh: false }, deps, context: PRINCIPAL, authorize });
    expect(deps.asked).toEqual([{ refresh: true }, { refresh: false }]);
  });

  it("reads neither the mailer nor the status source when authorization refuses", async () => {
    let reads = 0;
    const { authorize } = recordingAuthorize(["admin.forms.manage"]);
    const deps = makeDeps({ isMailDeliveryAvailable: () => { reads += 1; return true; }, mailStatus: async () => { reads += 1; return {}; } });
    await expect(mailStatusRoute.handle({ input: { refresh: false }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });

  it("rethrows a failing status source unchanged for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    const deps = makeDeps({ mailStatus: async () => { throw new Error("db down"); } });
    await expect(mailStatusRoute.handle({ input: { refresh: false }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
  });

  it("fails closed when mounted without an authorizer", async () => {
    await expect(mailStatusRoute.handle({ input: { refresh: false }, deps: makeDeps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
