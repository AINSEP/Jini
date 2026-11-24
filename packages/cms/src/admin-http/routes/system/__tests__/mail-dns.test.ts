import { describe, expect, it } from "vitest";
import { mailDnsStatusRoute, mailDnsVerifyRoute, type MailDnsOperation } from "../mail-dns.js";
import { PRINCIPAL, raw, recordingAuthorize, signal } from "./mail-test-helpers.js";

const STATUS = { state: "checked", dns: { persisted: false } };

describe.each([
  { name: "mailDnsStatusRoute", route: mailDnsStatusRoute, method: "get", path: "/api/admin/v1/workspaces/:workspaceId/system/mail-dns", permission: "deployments.read", field: "readMailDnsStatus" },
  { name: "mailDnsVerifyRoute", route: mailDnsVerifyRoute, method: "post", path: "/api/admin/v1/workspaces/:workspaceId/system/mail-dns/verify", permission: "deployments.publish", field: "verifyMailDnsStatus" },
] as const)("$name", ({ route, method, path, permission, field }) => {
  // The spec reads exactly one operation field; the other route's field is a different dep, so a cast pins `field`.
  const depsFor = (operation: MailDnsOperation) => ({ [field]: operation }) as never;

  it("keeps the method, path and status, takes no input and has no body cap", () => {
    expect([route.method, route.path]).toEqual([method, path]);
    expect(route.successStatus).toBeUndefined();
    expect(route.maxBodyBytes).toBeUndefined();
    expect(route.parse(raw({ body: { ignored: true } }))).toEqual({ ok: true, value: {} });
  });

  it(`authorizes ${permission} on the domain-dns entity type with no entity id, then answers the operation's status unchanged`, async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await route.handle({ input: {}, deps: depsFor(async () => STATUS), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission, entityType: "domain-dns" }]);
    expect(result).toEqual({ ok: true, value: STATUS });
  });

  it("runs the injected operation, not a default", async () => {
    const { authorize } = recordingAuthorize();
    const result = await route.handle({ input: {}, deps: depsFor(async () => ({ state: "injected" })), context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { state: "injected" } });
  });

  it("does not run the operation when authorization refuses", async () => {
    let runs = 0;
    const { authorize } = recordingAuthorize([permission]);
    await expect(route.handle({ input: {}, deps: depsFor(async () => { runs += 1; return STATUS; }), context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(runs).toBe(0);
  });

  it("rethrows an unexpected fault unchanged for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    await expect(route.handle({ input: {}, deps: depsFor(async () => { throw new Error("resolver down"); }), context: PRINCIPAL, authorize })).rejects.toThrow("resolver down");
  });

  it("fails closed when mounted without an authorizer", async () => {
    await expect(route.handle({ input: {}, deps: depsFor(async () => STATUS), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
