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

test("new install defaults to no replacement and posts the original zip bytes", async () => {
  const request = vi.fn(async (_input: { path: string; method: string; body: Blob }): Promise<unknown> => ({ id: "receipt" }));
  const digest = vi.fn(async (_algorithm: "SHA-256", _data: ArrayBuffer) => new Uint8Array([1, 16, 128]).buffer);
  const port = createAgentPluginInstallPort<{ id: string }>({
    request: <T,>(input: { path: string; method: string; body: Blob }) => request(input) as Promise<T>, workspaceId: "tenant-b", digest,
  });
  const bytes = Uint8Array.of(80, 75, 3, 4, 255);
  const file = new File([bytes], "report.zip", { type: "application/octet-stream" });
  expect(await port.sha256({ file })).toBe("011080");
  expect(digest.mock.calls).toEqual([["SHA-256", bytes.buffer]]);
  await expect(port.installZip({ file, sha256: "011080" })).resolves.toEqual({ id: "receipt" });
  expect(request).toHaveBeenCalledTimes(1);
  const [{ path, method, body }] = request.mock.calls[0]!;
  expect([path, method, body.type]).toEqual([
    "/workspaces/tenant-b/agent-plugins/install/zip?expectedSha256=011080&replace=false", "POST", "application/zip",
  ]);
  expect(new Uint8Array(await body.arrayBuffer())).toEqual(bytes);
});
