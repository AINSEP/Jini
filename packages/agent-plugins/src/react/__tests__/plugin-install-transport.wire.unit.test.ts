import { expect, test, vi } from "vitest";
import { createAgentPluginInstallPort } from "../agent-plugin-install-port.js";

test("updates carry the confirmed replacement and previous digest", async () => {
  const request = vi.fn(async (_input: { path: string; method: string; body: Blob }): Promise<unknown> => ({ accepted: true }));
  const digest = vi.fn(async () => new Uint8Array([0, 15, 255]).buffer);
  const port = createAgentPluginInstallPort<{ accepted: boolean }>({ request: <T,>(input: { path: string; method: string; body: Blob }) => request(input) as Promise<T>, workspaceId: "ws", digest });
  const file = new File(["zip"], "plugin.zip");
  expect(await port.sha256({ file })).toBe("000fff");
  expect(await port.installZip({ file, sha256: "new", replace: false, update: { pluginId: "plugin /", expectedOldDigest: "old" } })).toEqual({ accepted: true });
  const input = request.mock.calls[0]?.[0];
  expect(input?.path).toBe("/workspaces/ws/agent-plugins/plugin%20%2F/update/zip?expectedSha256=new&replace=false&expectedOldDigest=old");
  expect(input?.method).toBe("POST");
  expect(input?.body.type).toBe("application/zip");
});
