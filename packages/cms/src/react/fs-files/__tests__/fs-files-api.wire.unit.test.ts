import { expect, test, vi } from "vitest";
import { createFsFilesApi } from "../fs-files-api.js";

test("folder custom-root and picker requests retain verbs, paths and cancel values", async () => {
  const request = vi.fn(async <T,>(input: { path: string; method: string; body?: unknown }): Promise<T> => ({ path: null }) as T);
  const api = createFsFilesApi({ request, workspaceId: "ws" });
  await api.getFsFilesCustomRoot();
  await api.setFsFilesCustomRoot({ path: "/folder" });
  expect(await api.clearFsFilesCustomRoot()).toEqual({ path: null });
  await api.getFolderPicker();
  expect(await api.pickFolder()).toEqual({ path: null });
  expect(request.mock.calls.map(([input]) => input)).toEqual([
    { method: "GET", path: "/workspaces/ws/fs-files/custom-root" },
    { method: "PUT", path: "/workspaces/ws/fs-files/custom-root", body: { path: "/folder" } },
    { method: "DELETE", path: "/workspaces/ws/fs-files/custom-root" },
    { method: "GET", path: "/workspaces/ws/fs-files/folder-picker" },
    { method: "POST", path: "/workspaces/ws/fs-files/folder-picker" },
  ]);
});
