import { expect, test, vi } from "vitest";
import { createPluginInstallPort } from "../plugin-install-port.js";

test("folder JSON and zip previews preserve replacement consent and digest", async () => {
  const request = vi.fn(async (_input: { path: string; method: string; body: unknown }): Promise<unknown> => ({ plugin: { digest: "accepted" } }));
  const port = createPluginInstallPort<{ digest: string }>({ request: <T,>(input: { path: string; method: string; body: unknown }) => request(input) as Promise<T>, workspaceId: "ws" });
  const folder = { source: { kind: "folder" as const, path: "/plugin" }, replace: false };
  await port.preview(folder);
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/plugins/install/preview", method: "POST", body: folder });
  await port.install({ source: { kind: "zip", file: new File(["zip"], "plugin.zip") }, expectedDigest: "seen", replace: false });
  const input = request.mock.calls[1]?.[0];
  expect(input?.path).toBe("/workspaces/ws/plugins/install/zip?replace=false&expectedDigest=seen");
  expect(input?.body).toBeInstanceOf(Blob);
  expect((input?.body as Blob).type).toBe("application/zip");
});
