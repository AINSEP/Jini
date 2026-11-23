import { expect, test, vi } from "vitest";

import { createOwnerMfaPort, type AdminRequestOnceOps } from "../owner-mfa-api.js";
import { createOwnerPasskeyPorts } from "../owner-passkey-api.js";
import { createOwnerRecoveryFailure, createOwnerRecoveryPort } from "../owner-recovery-api.js";

/** The owner auth ports are single-send: each action is one `requestOnce` with a no-store POST body.
 *  The host's request client is injected; the host's own binding pins the API base. */
function stub() {
  const requestOnce = vi.fn(async (_required: unknown) => ({ ok: true }));
  return { http: { requestOnce } as unknown as AdminRequestOnceOps, requestOnce };
}
const postInit = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });

test("the MFA port reads status uncached and POSTs each action to its own path", async () => {
  const { http, requestOnce } = stub();
  const port = createOwnerMfaPort({ http });
  await port.status();
  await port.enroll({ password: "pw" } as never);
  await port.confirm({ code: "123456" } as never);
  await port.remove({ password: "pw" } as never);
  expect(requestOnce.mock.calls.map(([call]) => call)).toEqual([
    { path: "/auth/mfa", init: { cache: "no-store" } },
    { path: "/auth/mfa/enroll", init: postInit({ password: "pw" }) },
    { path: "/auth/mfa/confirm", init: postInit({ code: "123456" }) },
    { path: "/auth/mfa/remove", init: postInit({ password: "pw" }) },
  ]);
});

test("the passkey ports share one request client and name the sign-in ceremony actions", async () => {
  const { http, requestOnce } = stub();
  const { settings, signIn } = createOwnerPasskeyPorts({ http });
  await settings.status();
  await settings.enroll({ a: 1 } as never);
  await settings.confirm({ b: 2 } as never);
  await settings.remove({ c: 3 } as never);
  await signIn.begin({ d: 4 } as never);
  await expect(signIn.complete({ e: 5 } as never)).resolves.toBeUndefined();
  expect(requestOnce.mock.calls.map(([call]) => call)).toEqual([
    { path: "/auth/passkeys", init: { cache: "no-store" } },
    { path: "/auth/passkeys/enroll", init: postInit({ a: 1 }) },
    { path: "/auth/passkeys/confirm", init: postInit({ b: 2 }) },
    { path: "/auth/passkeys/remove", init: postInit({ c: 3 }) },
    { path: "/auth/passkeys/begin-login", init: postInit({ d: 4 }) },
    { path: "/auth/passkeys/login", init: postInit({ e: 5 }) },
  ]);
});

test("the recovery port reads status uncached and POSTs rotation, reset and redemption", async () => {
  const { http, requestOnce } = stub();
  const port = createOwnerRecoveryPort({ http });
  await port.status();
  await port.issue({ password: "pw", code: "1" });
  await port.reset({ password: "pw" });
  await port.recover({ code: "c", password: "pw" });
  expect(requestOnce.mock.calls.map(([call]) => call)).toEqual([
    { path: "/auth/owner-recovery", init: { cache: "no-store" } },
    { path: "/auth/recovery-codes", init: postInit({ password: "pw", code: "1" }) },
    { path: "/auth/reset-owner", init: postInit({ password: "pw" }) },
    { path: "/auth/recover-owner", init: postInit({ code: "c", password: "pw" }) },
  ]);
});

test("a recovery failure keeps the server's explanation, translates the copy and redacts submitted secrets", () => {
  const describeError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => (e instanceof Error ? e.message : fallback));
  const failure = createOwnerRecoveryFailure({ describeError, redactionOptions: {} })({
    error: new Error("wrong password hunter2"), message: "Could not reset.", action: "Try again.", step: "owner-reset",
    t: (key: string) => `T:${key}`, secrets: ["hunter2", ""],
  });
  expect(describeError).toHaveBeenCalledWith({ e: expect.any(Error), fallback: "T:Could not reset." });
  expect(failure.message).toContain("wrong password");
  expect(failure.action).toBe("T:Try again.");
  expect(failure.step).toBe("owner-reset");
  expect(failure.cause).toContain("wrong password");
  expect(JSON.stringify(failure)).not.toContain("hunter2");
});
