import { describe, expect, it } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { runApiConnectionConnect, startApiConnectionSignIn } from "../connect.js";
import { ApiConnectionError } from "../errors.js";
import { deriveApiConnectionKey } from "../keys.js";
import type { ApiConnectionHost } from "../host.js";
import type { DeclaredApiConnection } from "../host-ports.js";

const connection = { pluginId: "plug", descriptor: { connectionId: "acct", callbackFields: [{ name: "realmId" }] } } as unknown as DeclaredApiConnection;
const REF = deriveApiConnectionKey({ workspaceId: "ws-1", pluginId: "plug", connectionId: "acct" });
const messages = { toolError: ({ message }: { message: string }) => `tool: ${message}`, sharedUnavailable: "shared is unavailable" };
const signInLink = ({ callbackUrl, workspaceId, handoffId }: { callbackUrl: string; workspaceId: string; handoffId: string }) => `${callbackUrl}?ws=${workspaceId}&h=${handoffId}`;
const startResult = { authorizationUrl: "https://idp.test/auth", attemptId: "att-1", expiresAt: "2026-01-01T00:10:00.000Z", state: "st-1", browserBinding: "bb-1" };

interface FakeOpts { runtime?: "hosted" | "desktop"; start?: () => Promise<unknown>; receive?: () => Promise<unknown>; prepare?: () => Promise<void>; status?: string; granted?: string[]; generationBump?: boolean }

function fakeHost(o: FakeOpts = {}) {
  const log: { name: string; args: unknown[] }[] = [];
  const rec = (name: string, ...args: unknown[]) => { log.push({ name, args }); };
  const loopbackSignals: AbortSignal[] = [];
  let generation = 0;
  const service = {
    start: async (...args: unknown[]) => { rec("start", ...args); return o.start ? o.start() : startResult; },
    complete: async (...args: unknown[]) => { rec("complete", ...args); return { done: true }; },
    getStatus: async () => { if (o.generationBump) generation += 1; return { status: "connected" }; },
  };
  const host = {
    runtime: o.runtime ?? "hosted", workspaceId: "ws-1",
    records: { read: async () => ({ generation }) },
    serviceFor: (input: unknown) => { rec("serviceFor", input); return service; },
    hostedCallbackUrl: () => "https://site.test/cb",
    signInHandoffs: { issue: (input: unknown) => { rec("issue", input); return "handoff-1"; } },
    startLoopback: async (_req: unknown, opts: { signal: AbortSignal }) => {
      rec("startLoopback", opts); loopbackSignals.push(opts.signal);
      return { redirectUri: "http://127.0.0.1:5000/cb", receive: async (input: unknown) => { rec("receive", input); return o.receive ? o.receive() : { fields: { realmId: "r1" }, code: "code-1" }; } };
    },
    prepareSignIn: async (input: unknown) => { rec("prepareSignIn", input); await o.prepare?.(); return { service, workspaceId: "ws-t", onCompleted: async () => rec("onCompleted") }; },
    statusOf: async (input: unknown) => { rec("statusOf", input); return { connectionRef: REF, status: o.status ?? "disconnected", grantedScopes: o.granted ?? [] }; },
    requestedScopes: async () => ["read"],
    sharedOAuth: { selectLocal: async (c: unknown) => rec("selectLocal", c) },
  } as unknown as ApiConnectionHost;
  return { host, log, loopbackSignals, names: () => log.map(e => e.name) };
}

const signInReq = (host: ApiConnectionHost, destination?: "site" | "shared") => ({ host, connection, actorId: "actor-1", intent: "connect" as const, scopeSetIds: ["s1"], signInLink, messages, destination });

describe("startApiConnectionSignIn (hosted)", () => {
  it("refuses the shared destination with the host's message", async () => {
    const f = fakeHost();
    await expect(startApiConnectionSignIn(signInReq(f.host, "shared"))).rejects.toEqual(expect.objectContaining({ code: "connection-not-found", message: "shared is unavailable" }));
  });
  it("starts against the hosted callback and hands out the host's own sign-in link", async () => {
    const f = fakeHost();
    const out = await startApiConnectionSignIn(signInReq(f.host), { startParams: { prompt: "consent" } });
    expect(out).toEqual({ authorizationUrl: "https://site.test/cb?ws=ws-1&h=handoff-1", attemptId: "att-1", expiresAt: startResult.expiresAt });
    expect(f.log.filter(e => e.name !== "serviceFor")).toEqual([
      { name: "start", args: [{ workspaceId: "ws-1", actorId: "actor-1", intent: "connect", scopeSetIds: ["s1"], redirectUri: "https://site.test/cb" }, { startParams: { prompt: "consent" } }] },
      { name: "issue", args: [{ authorizationUrl: "https://idp.test/auth", browserBinding: "bb-1", actorId: "actor-1", expiresAt: startResult.expiresAt }] },
    ]);
  });
});

describe("startApiConnectionSignIn (desktop)", () => {
  it("listens on loopback, starts, and completes with the callback fields, state and code", async () => {
    const f = fakeHost({ runtime: "desktop" });
    const out = await startApiConnectionSignIn(signInReq(f.host, "site"), { timeoutMs: 900 });
    expect([out.authorizationUrl, out.attemptId]).toEqual(["https://idp.test/auth", "att-1"]);
    await expect(out.completion).resolves.toEqual({ done: true });
    expect(f.log.find(e => e.name === "startLoopback")?.args[0]).toEqual({ callbackFields: ["realmId"], signal: f.loopbackSignals[0], timeoutMs: 900 });
    expect(f.log.find(e => e.name === "prepareSignIn")?.args[0]).toEqual({ connection, actorId: "actor-1", destination: "site", redirectUri: "http://127.0.0.1:5000/cb" });
    expect(f.log.find(e => e.name === "receive")?.args[0]).toEqual({ expectedState: "st-1" });
    expect(f.log.find(e => e.name === "complete")?.args[0]).toEqual({ workspaceId: "ws-t", actorId: "actor-1", redirectUri: "http://127.0.0.1:5000/cb", callbackParams: { realmId: "r1", state: "st-1", code: "code-1" }, browserBinding: "bb-1" });
    expect(f.names().at(-1)).toBe("onCompleted");
  });
  it("resolves the completion to null when the callback never arrives", async () => {
    const f = fakeHost({ runtime: "desktop", receive: async () => { throw new Error("timeout"); } });
    const out = await startApiConnectionSignIn(signInReq(f.host));
    await expect(out.completion).resolves.toBeNull();
    expect(Object.keys(f.log.find(e => e.name === "startLoopback")?.args[0] as object)).toEqual(["callbackFields", "signal"]);
  });
  it("closes the listener and rethrows when preparing fails", async () => {
    const f = fakeHost({ runtime: "desktop", prepare: async () => { throw new Error("no client"); } });
    await expect(startApiConnectionSignIn(signInReq(f.host))).rejects.toThrow("no client");
    expect(f.loopbackSignals[0]?.aborted).toBe(true);
  });
  it("aborts an earlier listener for the same connection, and listens to the caller's signal", async () => {
    const f = fakeHost({ runtime: "desktop", receive: () => new Promise(() => {}) });
    const caller = new AbortController();
    await startApiConnectionSignIn(signInReq(f.host), { signal: caller.signal });
    expect(f.loopbackSignals[0]?.aborted).toBe(false);
    await startApiConnectionSignIn(signInReq(f.host));
    expect(f.loopbackSignals.map(s => s.aborted)).toEqual([true, false]);
    const other = fakeHost({ runtime: "desktop", receive: () => new Promise(() => {}) });
    const c2 = new AbortController();
    await startApiConnectionSignIn(signInReq(other.host), { signal: c2.signal });
    c2.abort();
    expect(other.loopbackSignals[0]?.aborted).toBe(true);
  });
});

const run = (host: ApiConnectionHost, extra: { destination?: "site" | "shared"; waitTimeoutMs?: number } = {}) => {
  const shown: string[] = [];
  const promise = runApiConnectionConnect({ deps: { host }, connection, actorId: "actor-1", signInLink, messages, signal: new AbortController().signal, pollIntervalMs: 1,
    waitTimeoutMs: extra.waitTimeoutMs ?? 1000, destination: extra.destination, showSignIn: async ({ signInUrl }) => { shown.push(signInUrl); } });
  return { promise, shown };
};

describe("runApiConnectionConnect: already connected", () => {
  it("returns connected and selects the local copy for the site destination", async () => {
    const f = fakeHost({ status: "connected", granted: ["read", "write"] });
    await expect(run(f.host, { destination: "site" }).promise).resolves.toEqual({ status: "connected", connectionRef: REF });
    expect(f.log.filter(e => e.name !== "statusOf")).toEqual([{ name: "selectLocal", args: [connection] }]);
    expect(f.log[0]).toEqual({ name: "statusOf", args: [{ connection, local: true }] });
  });
  it("returns connected without selecting when no destination is named", async () => {
    const f = fakeHost({ status: "connected", granted: ["read"] });
    await expect(run(f.host).promise).resolves.toEqual({ status: "connected", connectionRef: REF });
    expect(f.names()).toEqual(["statusOf"]);
  });
});

describe("runApiConnectionConnect: hosted", () => {
  it("shows the same-origin path and reports connected once the generation advances", async () => {
    const f = fakeHost({ status: "connected", granted: [], generationBump: true });
    const r = run(f.host);
    await expect(r.promise).resolves.toEqual({ status: "connected", connectionRef: REF });
    expect(r.shown).toEqual(["/cb"]);
  });
  it("reports waiting-for-sign-in when the wait ends first", async () => {
    const f = fakeHost();
    await expect(run(f.host, { waitTimeoutMs: 0 }).promise).resolves.toEqual({ status: "waiting-for-sign-in", connectionRef: REF });
  });
  it("maps a connection refusal to a tool input error and rethrows anything else", async () => {
    const refused = fakeHost({ start: async () => { throw new ApiConnectionError({ code: "descriptor-invalid", message: "no client" }); } });
    const error = await run(refused.host).promise.catch((e: unknown) => e);
    expect([error instanceof ToolInputError, (error as Error).message]).toEqual([true, "tool: no client"]);
    await expect(run(fakeHost({ start: async () => { throw new TypeError("boom"); } }).host).promise).rejects.toThrow(TypeError);
  });
});

describe("runApiConnectionConnect: desktop", () => {
  it("shows the provider URL and reports connected when the completion resolves", async () => {
    const r = run(fakeHost({ runtime: "desktop", status: "connected", granted: ["read"] }).host, { destination: "shared" });
    await expect(r.promise).resolves.toEqual({ status: "connected", connectionRef: REF });
    expect(r.shown).toEqual(["https://idp.test/auth"]);
  });
  it("reports waiting when the callback never arrives", async () => {
    const r = run(fakeHost({ runtime: "desktop", receive: async () => { throw new Error("closed"); } }).host);
    await expect(r.promise).resolves.toEqual({ status: "waiting-for-sign-in", connectionRef: REF });
  });
  it("maps a refusal from the start to a tool input error", async () => {
    const r = run(fakeHost({ runtime: "desktop", start: async () => { throw new ApiConnectionError({ code: "descriptor-invalid", message: "bad" }); } }).host);
    await expect(r.promise).rejects.toThrow("tool: bad");
  });
});
