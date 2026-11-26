import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRemoveConfirmDialog, useAddCustomCredentialDialog } from "../AccessTokensTab.hooks.js";
import type { AccessTokenRow } from "../../access-token-rows.js";

afterEach(cleanup);

test("removal confirmation closes the dialog before invoking the stored-row removal", () => {
  const events: string[] = [];
  const ref = { current: { close: () => events.push("close") } as HTMLDialogElement };
  const row = { id: "stored" } as AccessTokenRow;
  const removeToken = vi.fn(async () => { events.push("remove"); });
  const { result } = renderHook(() => useRemoveConfirmDialog({ ref, row, controller: { removeToken } }));
  expect(removeToken).not.toHaveBeenCalled();
  result.current.confirm();
  expect(events).toEqual(["close", "remove"]);
  expect(removeToken).toHaveBeenCalledWith(row);
});

test("a custom credential needs its key, and a failed save leaves the dialog open", async () => {
  const close = vi.fn();
  const controller = {
    customAddForm: { name: "Key", category: "general" as const, baseUrl: "https://example.test", additionalHosts: "", token: "", username: "" },
    resetCustomAddForm: vi.fn(), createCustomCredential: vi.fn(async () => false),
  };
  const ref = { current: { close } as unknown as HTMLDialogElement };
  const { result, rerender } = renderHook(() => useAddCustomCredentialDialog({ ref, controller }));
  expect(result.current.readyToSave).toBe(false);
  controller.customAddForm.token = "key";
  rerender();
  expect(result.current.readyToSave).toBe(true);
  await result.current.save();
  expect(close).not.toHaveBeenCalled();
  result.current.close();
  expect(close).toHaveBeenCalledOnce();
  expect(controller.resetCustomAddForm).toHaveBeenCalledOnce();
});

test("other stores retain search counts through a partial failure and serialize replacement before removal", async () => {
  const { act, waitFor } = await import("@testing-library/react");
  const { useSerialWrites } = await import("@jini-ai/ui/panel-kit");
  const { useOtherCredentials } = await import("../hooks/use-other-credentials.hooks.js");
  const data = { isSet: true, masked: "••••tail", provider: "host", baseUrl: null, model: null, updatedAt: null };
  const events: string[] = [];
  let release!: () => void;
  let configured = true;
  const port = {
    getSiteAssistantCredential: vi.fn(async () => ({ data: { ...data, isSet: configured } })),
    setSiteAssistantCredential: vi.fn(() => new Promise<{ data: typeof data }>(resolve => { release = () => { events.push("replace"); resolve({ data }); }; })),
    deleteSiteAssistantCredential: vi.fn(async () => { events.push("remove"); configured = false; return { data: { ...data, isSet: false } }; }),
    getAdminByokCredential: vi.fn(), setAdminByokCredential: vi.fn(), deleteAdminByokCredential: vi.fn(),
    getMediaProviders: vi.fn(async () => { throw new Error("media unavailable"); }), getMediaProviderCatalog: vi.fn(async () => null),
    patchMediaProvider: vi.fn(), removeMediaProvider: vi.fn(), listExternalMcpServers: vi.fn(), deleteExternalMcpServer: vi.fn(),
  };
  const stores = [{ id: "site-assistant" as const, label: "Assistant", category: "ai" as const, purposeLabel: "AI", supportsReplace: true, screenLabel: "Manage", screenPath: "/assistant" },
    { id: "media-provider" as const, label: "Media", category: "media" as const, purposeLabel: "Media", supportsReplace: true, screenLabel: "Manage", screenPath: "/media" }];
  const { result } = renderHook(() => useOtherCredentials({ port, t: key => key, locale: "en", filter: { query: "Assistant", category: "all" },
    hooks: { useSerialWrites, useContentRefreshSubscription: () => {} }, deps: {
      stores, resource: "credentials", credentialDraftError: () => null,
      formatCredentialHint: () => "", formatCredentialHints: () => "", translateCredentialMessage: ({ message }) => message,
      envNamesFact: () => "", maskedTailFact: ({ tail }) => tail,
      mediaProviderCatalogFrom: () => [], mediaProviderLabel: ({ providerId }) => providerId,
      otherCredentialMatchesQuery: ({ store, itemName, query }) => `${store.label} ${itemName ?? ""}`.includes(query),
      describeApiError: ({ e }) => String(e), accessTokensLoadErrorMessage: ({ error }) => error, accessTokenSaveErrorMessage: ({ error }) => error,
    } }));
  await waitFor(() => expect(result.current.groups).toHaveLength(2));
  expect(result.current.loadError).toContain("media unavailable");
  expect(result.current.totalCount).toBe(1);
  expect(result.current.matchCount).toBe(1);
  const row = result.current.groups?.[0]?.rows[0];
  if (!row) throw new Error("missing stored row");
  act(() => result.current.setDraftToken({ key: row.key, value: "replacement" }));
  let replacing!: Promise<void>;
  let removing!: Promise<void>;
  act(() => { replacing = result.current.replace(row); removing = result.current.remove(row); });
  await waitFor(() => expect(port.setSiteAssistantCredential).toHaveBeenCalledOnce());
  expect(port.deleteSiteAssistantCredential).not.toHaveBeenCalled();
  await act(async () => { release(); await replacing; await removing; });
  expect(events).toEqual(["replace", "remove"]);
  expect(result.current.totalCount).toBe(0);
  expect(result.current.matchCount).toBe(0);
});
