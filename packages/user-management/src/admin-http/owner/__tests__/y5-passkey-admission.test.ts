import { describe, expect, it, vi } from "vitest";
import { registerOwnerPasskeyRoutes } from "../passkey-routes.js";

describe("owner passkey mount admission", () => {
  it("mounts status and five actions and keeps nonowner status from reading credentials", async () => {
    const routes: Parameters<Parameters<typeof registerOwnerPasskeyRoutes>[0]["mount"]>[0][] = [];
    registerOwnerPasskeyRoutes({ root: "/passkeys", mount: input => { routes.push(input); } });
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual(["post /passkeys/enroll", "post /passkeys/confirm", "post /passkeys/begin-login", "post /passkeys/login", "post /passkeys/remove", "get /passkeys"]);
    const json = vi.fn();
    const passkeyDeps = vi.fn();
    const noStore = vi.fn();
    await routes[5]!.handle({ noStore, authenticate: async () => ({ kind: "tool", principal: { id: "owner" } }), ownerPrincipalId: async () => "owner", passkeyDeps, workspaceId: "ws", json } as Parameters<(typeof routes)[number]["handle"]>[0]);
    expect(noStore).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ isOwner: false, credentials: [] });
    expect(passkeyDeps).not.toHaveBeenCalled();
  });
});
