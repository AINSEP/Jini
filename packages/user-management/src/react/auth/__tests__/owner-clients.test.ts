import { expect, it } from "vitest";

import { readInitialSession } from "../../../session-bootstrap/index.js";
import { createLocalOwnerSignIn, isLocalOwnerSignInHost } from "../local-owner-signin.js";
import { createOwnerMfaPort } from "../owner-mfa-api.js";
import { createOwnerPasskeyPorts } from "../owner-passkey-api.js";
import { createOwnerRecoveryClient } from "../owner-recovery-api.js";

/** The owner clients bind to the host's single-send request function; every call is recorded. */
function recorder() {
  const calls: Array<{ path: string; init?: RequestInit | undefined }> = [];
  const requestOnce = async <T,>({ path, init }: { path: string; init?: RequestInit }): Promise<T> => {
    calls.push({ path, init });
    return { ok: path } as T;
  };
  return { calls, requestOnce };
}
const posted = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });

it("the MFA port reads status uncached and posts each action once to its own path", async () => {
  const { calls, requestOnce } = recorder();
  const port = createOwnerMfaPort({ requestOnce });
  await port.status();
  await port.enroll({ password: "fixture-pw" } as never);
  await port.confirm({ code: "123456" } as never);
  await port.remove({ password: "fixture-pw" } as never);
  expect(calls).toEqual([
    { path: "/auth/mfa", init: { cache: "no-store" } },
    { path: "/auth/mfa/enroll", init: posted({ password: "fixture-pw" }) },
    { path: "/auth/mfa/confirm", init: posted({ code: "123456" }) },
    { path: "/auth/mfa/remove", init: posted({ password: "fixture-pw" }) },
  ]);
});

it("the passkey ports post ceremonies to their own paths and sign-in completion resolves to nothing", async () => {
  const { calls, requestOnce } = recorder();
  const { settings, signIn } = createOwnerPasskeyPorts({ requestOnce });
  await settings.status();
  await settings.enroll({ a: 1 } as never);
  await settings.confirm({ b: 2 } as never);
  await settings.remove({ c: 3 } as never);
  await signIn.begin({ d: 4 } as never);
  expect(await signIn.complete({ e: 5 } as never)).toBeUndefined();
  expect(calls.map(({ path }) => path)).toEqual(["/auth/passkeys", "/auth/passkeys/enroll", "/auth/passkeys/confirm", "/auth/passkeys/remove", "/auth/passkeys/begin-login", "/auth/passkeys/login"]);
  expect(calls[0]!.init).toEqual({ cache: "no-store" });
  expect(calls[5]!.init).toEqual(posted({ e: 5 }));
});

it("the recovery port posts each transition and its failure redacts submitted secrets with the host's options", async () => {
  const { calls, requestOnce } = recorder();
  const { port, failure } = createOwnerRecoveryClient({
    requestOnce,
    describeApiError: ({ e, fallback }) => (e instanceof Error ? e.message || fallback : fallback),
    redactionOptions: {},
  });
  await port.status();
  await port.issue({ password: "fixture-pw" });
  await port.reset({ password: "fixture-pw" });
  await port.recover({ code: "fixture-code", password: "fixture-pw" });
  expect(calls.map(({ path }) => path)).toEqual(["/auth/owner-recovery", "/auth/recovery-codes", "/auth/reset-owner", "/auth/recover-owner"]);
  expect(calls[3]!.init).toEqual(posted({ code: "fixture-code", password: "fixture-pw" }));
  const error = new Error("server said fixture-code and fixture-pw were wrong");
  const result = failure({ error, message: "Could not recover.", action: "Try again.", step: "owner-recover", t: (key: string) => `t:${key}`, secrets: ["fixture-code", "fixture-pw", ""] });
  const text = JSON.stringify(result);
  expect(text).not.toContain("fixture-code");
  expect(text).not.toContain("fixture-pw");
  expect(result.action).toBe("t:Try again.");
});

class FixtureApiError extends Error {
  constructor(readonly status: number, readonly code?: string) { super("fixture"); }
}

it("local sign-in bootstraps only an unauthenticated local browser, recognized through the host's error class", async () => {
  const { readInitialAdminSession } = createLocalOwnerSignIn({ apiErrorClass: FixtureApiError, readInitialSession });
  const calls: string[] = [];
  const result = await readInitialAdminSession({ hostname: "127.0.0.1", port: {
    async signInLocalOwner() { calls.push("bootstrap"); },
    async me() { calls.push("me"); if (calls.length === 1) throw new FixtureApiError(401, "UNAUTHENTICATED"); return "session"; },
  } });
  expect(result).toBe("session");
  expect(calls).toEqual(["me", "bootstrap", "me"]);
  const foreign = Object.assign(new Error("x"), { status: 401, code: "UNAUTHENTICATED" });
  await expect(readInitialAdminSession({ hostname: "localhost", port: { async signInLocalOwner() { calls.push("never"); }, async me() { throw foreign; } } })).rejects.toBe(foreign);
  expect(calls).not.toContain("never");
  expect(isLocalOwnerSignInHost({ hostname: "[::1]" })).toBe(true);
  expect(isLocalOwnerSignInHost({ hostname: "localhost.evil.example" })).toBe(false);
});

// Carried from w3-fnd's duplicate `admin/shell/lib` copy (rv1123l FIX 10): its port-level pins,
// rebuilt over this module's factory so the single surviving owner keeps both lanes' coverage.
it.each(["localhost", "127.0.0.1", "[::1]"])("admits the local browser %s", (hostname) => {
  expect(isLocalOwnerSignInHost({ hostname })).toBe(true);
});

it.each(["example.com", "localhost.evil.example", "0.0.0.0", "192.168.1.2"])("never admits the remote browser %s", (hostname) => {
  expect(isLocalOwnerSignInHost({ hostname })).toBe(false);
});

type ReaderPorts = Parameters<Parameters<typeof createLocalOwnerSignIn>[0]["readInitialSession"]>[0];
function captureReader() {
  const seen: { ports?: ReaderPorts; optional?: { onBootstrapped?: () => void } | undefined } = {};
  const reader = (async (ports: ReaderPorts, optional?: { onBootstrapped?: () => void }) => {
    seen.ports = ports; seen.optional = optional; return "session";
  }) as Parameters<typeof createLocalOwnerSignIn>[0]["readInitialSession"];
  return { seen, ...createLocalOwnerSignIn({ apiErrorClass: FixtureApiError, readInitialSession: reader }) };
}

it("hands the reader the port's identity read, the local bootstrap and the hostname admission", async () => {
  const { seen, readInitialAdminSession } = captureReader();
  const bootstraps: string[] = [];
  const port = { async signInLocalOwner() { bootstraps.push("bootstrap"); }, async me() { return { id: "owner" }; } };
  await expect(readInitialAdminSession({ hostname: "example.com", port })).resolves.toBe("session");
  await expect(seen.ports!.me()).resolves.toEqual({ id: "owner" });
  await seen.ports!.bootstrap();
  expect(bootstraps).toEqual(["bootstrap"]);
  expect(seen.ports!.admit()).toBe(false);
  expect(seen.optional).toEqual({});
});

it("treats only the host's 401 UNAUTHENTICATED error class as unauthenticated", async () => {
  const { seen, readInitialAdminSession } = captureReader();
  await readInitialAdminSession({ hostname: "localhost", port: { async signInLocalOwner() {}, async me() { return null; } } });
  const isUnauthenticated = (error: unknown) => seen.ports!.isUnauthenticated({ error });
  expect(isUnauthenticated(new FixtureApiError(401, "UNAUTHENTICATED"))).toBe(true);
  expect(isUnauthenticated(new FixtureApiError(401, "UPSTREAM_REQUEST_FAILED"))).toBe(false);
  expect(isUnauthenticated(new FixtureApiError(500, "UNAUTHENTICATED"))).toBe(false);
  expect(isUnauthenticated(Object.assign(new Error("unauthenticated"), { status: 401, code: "UNAUTHENTICATED" }))).toBe(false);
});

it("never bootstraps a remote browser even on a 401 UNAUTHENTICATED", async () => {
  const { readInitialAdminSession } = createLocalOwnerSignIn({ apiErrorClass: FixtureApiError, readInitialSession });
  const denied = new FixtureApiError(401, "UNAUTHENTICATED");
  const calls: string[] = [];
  await expect(readInitialAdminSession({ hostname: "example.com", port: { async signInLocalOwner() { calls.push("bootstrap"); }, async me() { throw denied; } } })).rejects.toBe(denied);
  expect(calls).toEqual([]);
});

it("maps onLocalSignIn to the reader's onBootstrapped", async () => {
  const { seen, readInitialAdminSession } = captureReader();
  const onLocalSignIn = () => undefined;
  await readInitialAdminSession({ hostname: "localhost", port: { async signInLocalOwner() {}, async me() { return null; } } }, { onLocalSignIn });
  expect(seen.optional).toEqual({ onBootstrapped: onLocalSignIn });
});
