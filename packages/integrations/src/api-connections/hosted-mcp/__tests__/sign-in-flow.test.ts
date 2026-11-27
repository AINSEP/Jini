import { describe, expect, it } from "vitest";
import type { OAuthClient, OAuthProviderDescriptor } from "@jini-ai/core/contracts/oauth";
import type { SignInDeps, ExternalMcpOAuthServiceDeps } from "../sign-in-provider.js";
import { beginDeviceCodeConnect, CLIENT_REJECTED_PROVIDER_CODES, CONNECT_TIMEOUT_MS, ownerKeyOf, resourceOption, sealedRedirectState } from "../sign-in-flow.js";
import { FakeRepo, makeHarness, makeRecord } from "./sign-in-harness.js";

describe("small sign-in values", () => {
  it("binds owner keys to workspace and server and names the client-rejection codes", () => {
    expect(ownerKeyOf("ws-1", "srv")).toBe("ws-1:srv");
    expect(CLIENT_REJECTED_PROVIDER_CODES).toEqual(["invalid_client", "unauthorized_client"]);
    expect(CONNECT_TIMEOUT_MS).toBe(15_000);
  });
  it("omits an absent resource rather than passing undefined", () => {
    expect(resourceOption(undefined)).toEqual({});
    expect(resourceOption("https://r.test")).toEqual({ resource: "https://r.test" });
  });
});

describe("beginDeviceCodeConnect", () => {
  it("starts the device authorization, parks it, marks the row pending and returns the user code", async () => {
    const authorization = { deviceCode: "dc", userCode: "ABCD", verificationUri: "https://v.test", verificationUriComplete: "https://v.test?c=ABCD", expiresAt: "2026-01-02T03:14:05.000Z", intervalSeconds: 5 };
    const h = makeHarness(new FakeRepo(makeRecord()), { flow: { beginDeviceAuthorization: async () => authorization } });
    const provider = { id: "p" } as unknown as OAuthProviderDescriptor;
    const client = { clientId: "c1" } as OAuthClient;
    const start = await beginDeviceCodeConnect({ deps: h.deps as ExternalMcpOAuthServiceDeps, record: makeRecord(), provider, client, scopes: ["s"], resource: "https://r.test" });
    expect(start).toEqual({ kind: "device_code", userCode: "ABCD", verificationUri: "https://v.test", verificationUriComplete: "https://v.test?c=ABCD", expiresAt: "2026-01-02T03:14:05.000Z", intervalSeconds: 5 });
    expect(h.flowCalls).toEqual([{ name: "beginDeviceAuthorization", args: [
      { guard: { tag: "guard" }, provider, clock: h.deps.clock, client },
      { scopes: ["s"], resource: "https://r.test", timeoutMs: 15_000 },
    ] }]);
    expect(h.devicesPut).toEqual([["srv", authorization]]);
    expect(h.repo.rows.get("srv")?.oauthStatus).toBe("pending");
  });
});

describe("sealedRedirectState", () => {
  function harnessWithCodec() {
    const sealCalls: unknown[] = [];
    const openCalls: unknown[] = [];
    const h = makeHarness(new FakeRepo(), {
      flow: { createSealedAuthorizationState: (input: never) => input },
      extra: {
        keyring: { activeKey: async () => ({ id: "key-1" }) } as unknown as SignInDeps["keyring"],
        sealer: {
          seal: async (input: unknown) => { sealCalls.push(input); return { ct: "x" }; },
          open: async (...args: unknown[]) => { openCalls.push(args); return "plain"; },
        } as unknown as SignInDeps["sealer"],
      },
    });
    return { h, sealCalls, openCalls };
  }
  type Codec = { seal(i: { plaintext: string }): Promise<string>; open(i: { state: string }): Promise<string> };

  it("binds the state AAD to workspace, server, browser and config, and round-trips through base64url", async () => {
    const { h, sealCalls, openCalls } = harnessWithCodec();
    const made = sealedRedirectState({ deps: h.deps, serverId: "srv", browserBinding: "b1", config: { createdAt: "c-at", version: 7 } }) as unknown as { clock: unknown; workspaceId: string; serverId: string; codec: Codec };
    expect([made.clock, made.workspaceId, made.serverId]).toEqual([h.deps.clock, "ws-1", "srv"]);
    const aad = 'oauth-redirect-state|v2|["ws-1","srv","b1","c-at",7]';
    const state = await made.codec.seal({ plaintext: "p" });
    expect(sealCalls).toEqual([{ plaintext: "p", key: { id: "key-1" }, aad }]);
    expect(JSON.parse(Buffer.from(state, "base64url").toString("utf8"))).toEqual({ ct: "x" });
    await expect(made.codec.open({ state })).resolves.toBe("plain");
    expect(openCalls).toEqual([[{ sealed: { ct: "x" } }, { aad }]]);
  });

  it("leaves the browser out of the AAD when no binding is given", async () => {
    const { h, sealCalls } = harnessWithCodec();
    const made = sealedRedirectState({ deps: h.deps, serverId: "srv", config: { createdAt: "c-at", version: 1 } }) as unknown as { codec: Codec };
    await made.codec.seal({ plaintext: "p" });
    expect(sealCalls).toEqual([{ plaintext: "p", key: { id: "key-1" }, aad: 'oauth-redirect-state|v2|["ws-1","srv","c-at",1]' }]);
  });
});
