import { expect, it, vi } from "vitest";

import { createReadInitialAdminSession, isLocalOwnerSignInHost, type InitialSessionPorts, type ReadInitialSession } from "../local-owner-signin.js";
import { FakeRequestError as ApiError, isFakeRequestError } from "./request-error.fakes.js";

/** The bootstrap policy itself (ordering, no retry, original-error preservation) is the injected reader's;
 *  the host's binding test exercises it end to end. This pins the ports this module builds for it. */
function capture() {
  const seen: { ports?: InitialSessionPorts<unknown>; optional?: { onBootstrapped?: () => void } | undefined } = {};
  const reader = vi.fn(async (ports: InitialSessionPorts<unknown>, optional?: { onBootstrapped?: () => void }) => {
    seen.ports = ports; seen.optional = optional; return "session";
  }) as unknown as ReadInitialSession;
  return { seen, read: createReadInitialAdminSession({ readInitialSession: reader, isRequestError: isFakeRequestError }) };
}

it.each(["localhost", "127.0.0.1", "[::1]"])("admits the local browser %s", (hostname) => {
  expect(isLocalOwnerSignInHost({ hostname })).toBe(true);
});

it.each(["example.com", "localhost.evil.example", "0.0.0.0", "192.168.1.2"])("never admits the remote browser %s", (hostname) => {
  expect(isLocalOwnerSignInHost({ hostname })).toBe(false);
});

it("hands the reader the port's identity read, the local bootstrap and the hostname admission", async () => {
  const { seen, read } = capture();
  const port = { signInLocalOwner: vi.fn(async () => undefined), me: vi.fn(async () => ({ id: "owner" })) };
  await expect(read({ hostname: "example.com", port })).resolves.toBe("session");
  await expect(seen.ports!.me({})).resolves.toEqual({ id: "owner" });
  await seen.ports!.bootstrap({});
  expect(port.signInLocalOwner).toHaveBeenCalledWith({});
  expect(seen.ports!.admit({})).toBe(false);
  expect(seen.optional).toEqual({});
});

it("treats only the host's 401 UNAUTHENTICATED request error as unauthenticated", async () => {
  const { seen, read } = capture();
  await read({ hostname: "localhost", port: { signInLocalOwner: async () => undefined, me: async () => ({}) } });
  const isUnauthenticated = (error: unknown) => seen.ports!.isUnauthenticated({ error });
  expect(isUnauthenticated(new ApiError({ message: "unauthenticated", status: 401 }, { code: "UNAUTHENTICATED" }))).toBe(true);
  expect(isUnauthenticated(new ApiError({ message: "refusal", status: 401 }, { code: "UPSTREAM_REQUEST_FAILED" }))).toBe(false);
  expect(isUnauthenticated(new ApiError({ message: "storage", status: 500 }, { code: "UNAUTHENTICATED" }))).toBe(false);
  expect(isUnauthenticated(Object.assign(new Error("unauthenticated"), { status: 401, code: "UNAUTHENTICATED" }))).toBe(false);
});

it("maps onLocalSignIn to the reader's onBootstrapped", async () => {
  const { seen, read } = capture();
  const onLocalSignIn = () => undefined;
  await read({ hostname: "localhost", port: { signInLocalOwner: async () => undefined, me: async () => ({}) } }, { onLocalSignIn });
  expect(seen.optional).toEqual({ onBootstrapped: onLocalSignIn });
});
