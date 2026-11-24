import { describe, expect, it } from "vitest";
import { createFormsApi } from "../forms-api.js";

describe("createFormsApi", () => {
  it("lists forms through the injected request, scoped to the injected workspace", async () => {
    const calls: unknown[] = [];
    const api = createFormsApi({ request: async <T>(required: { method: string; path: string }): Promise<T> => { calls.push(required); return { data: [] } as T; }, workspaceId: "ws-2" });
    expect(await api.listForms()).toEqual({ data: [] });
    expect(calls).toEqual([{ method: "GET", path: "/workspaces/ws-2/forms" }]);
  });
});
