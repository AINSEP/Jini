import { describe, expect, it, vi } from "vitest";
import { createSourceControlApi } from "../source-control-api.js";

describe("createSourceControlApi request shapes", () => {
  it("names the source-control paths, methods and bodies", async () => {
    const request = vi.fn(async () => ({}));
    const api = createSourceControlApi({ request: request as never, workspaceId: "w1" });
    await api.listSourceControlProviders();
    await api.listSourceControlCredentials();
    await api.createSourceControlCredential({ label: "L", connection: { providerId: "github", token: "t" }, isDefault: true });
    await api.updateSourceControlCredential({ id: "a/b", input: { isDefault: false } });
    await api.deleteSourceControlCredential({ id: "a/b" });
    const calls = request.mock.calls as unknown as [{ path: string }, { init?: RequestInit }?][];
    expect(calls.map(([r, o]) => [r.path, o?.init?.method])).toEqual([
      ["/workspaces/w1/system/source-control/providers", undefined],
      ["/workspaces/w1/system/source-control/credentials", undefined],
      ["/workspaces/w1/system/source-control/credentials", "POST"],
      ["/workspaces/w1/system/source-control/credentials/a%2Fb", "PUT"],
      ["/workspaces/w1/system/source-control/credentials/a%2Fb", "DELETE"],
    ]);
    expect(JSON.parse(String(calls[2]![1]!.init!.body))).toEqual({ label: "L", connection: { providerId: "github", token: "t" }, isDefault: true });
  });
});
