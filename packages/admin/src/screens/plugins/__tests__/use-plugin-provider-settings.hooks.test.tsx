// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePluginProviderSettings } from "../hooks/use-plugin-provider-settings.hooks.js";
import type { PluginsPort } from "../hooks/plugins-port.hooks.js";
import { deferred } from "./plugin-hook-test-fixtures.js";

/** The host's describer, faked so the tests can tell it was the one consulted. */
const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }): string => `described(${String(e)}|${fallback})`;
const t = (key: string): string => key;

function portThatFails(): Pick<PluginsPort, "getProviderSettings" | "saveProviderSettings" | "useProjectKey"> {
  return {
    getProviderSettings: async () => { throw "load-boom"; },
    saveProviderSettings: async () => { throw "save-boom"; },
  };
}

describe("usePluginProviderSettings", () => {
  it("shows a load failure in the injected describer's words", async () => {
    const port = portThatFails();
    const { result } = renderHook(() => usePluginProviderSettings({ pluginId: "p", port, t, describeApiError }));
    await waitFor(() => expect(result.current.error).toBe("described(load-boom|failed to load plugin settings)"));
  });

  it("shows a save failure in the injected describer's words and resolves false", async () => {
    const port = portThatFails();
    const { result } = renderHook(() => usePluginProviderSettings({ pluginId: "p", port, t, describeApiError }));
    await waitFor(() => expect(result.current.error).toContain("load-boom"));
    let saved = true;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(result.current.error).toBe("described(save-boom|failed to save plugin settings)");
    expect(result.current.saving).toBe(false);
  });
});

type Card = Awaited<ReturnType<PluginsPort["getProviderSettings"]>>;
const initialCard: Card = {
  pluginId: "metrics", store: "project", keyId: "key-metrics", appliesAt: "now", usedByThisSite: false, usedBy: ["preview"],
  fields: [
    { name: "endpoint", label: "Endpoint", secret: false, saved: true, required: true, value: "https://saved.test", default: "https://default.test" },
    { name: "region", label: "Region", secret: false, saved: false, required: false, default: "west" },
    { name: "group", label: "Group", secret: false, saved: false, required: false },
    { name: "token", label: "Token", secret: true, saved: true, required: true, default: "never prefill secrets" },
  ],
};
const cannotStart = "Saved, but the provider could not start. Check the plugin settings and save again.";

function renderCard(port: Pick<PluginsPort, "getProviderSettings" | "saveProviderSettings" | "useProjectKey">) {
  return renderHook(() => usePluginProviderSettings({ pluginId: "metrics", port, t, describeApiError }));
}

it.each([
  { message: undefined, appliesAt: "now", expected: true, error: null },
  { message: undefined, appliesAt: "failed", expected: false, error: cannotStart },
  { message: "Endpoint refused", appliesAt: "failed", expected: false, error: "Endpoint refused" },
] as const)("saves the entered values and reads back the card when application is $appliesAt ($message)", async ({ appliesAt, message, expected, error }) => {
  const next: Card = { ...initialCard, appliesAt, ...(message === undefined ? {} : { message }), fields: [
    { name: "endpoint", label: "Endpoint", secret: false, saved: true, required: true, value: "https://normalized.test" },
    initialCard.fields[3]!,
  ] };
  const pending = deferred<Card>();
  const getProviderSettings = vi.fn<PluginsPort["getProviderSettings"]>().mockResolvedValue(initialCard);
  const saveProviderSettings = vi.fn<PluginsPort["saveProviderSettings"]>(() => pending.promise);
  const { result } = renderCard({ getProviderSettings, saveProviderSettings });
  await waitFor(() => expect(result.current.card).toEqual(initialCard));
  expect(getProviderSettings).toHaveBeenCalledExactlyOnceWith({ id: "metrics" });
  expect(result.current.values).toEqual({ endpoint: "https://saved.test", region: "west", group: "", token: "" });
  act(() => { result.current.setValue({ name: "endpoint", value: "https://entered.test" }); result.current.setValue({ name: "token", value: "new token" }); });
  let saving!: Promise<boolean>;
  act(() => { saving = result.current.save(); });
  expect(saveProviderSettings).toHaveBeenCalledExactlyOnceWith({ id: "metrics", values: {
    endpoint: "https://entered.test", region: "west", group: "", token: "new token",
  } });
  expect(result.current.saving).toBe(true);
  await act(async () => { pending.resolve(next); expect(await saving).toBe(expected); });
  expect(result.current.card).toEqual(next);
  expect(result.current.values).toEqual({ endpoint: "https://normalized.test", token: "" });
  expect(result.current.error).toBe(error);
  expect(result.current.saving).toBe(false);
});

it("cannot attach a key without both a saved key id and a host attachment port", async () => {
  const { keyId: _unused, ...noKey } = initialCard;
  const attach = vi.fn<NonNullable<PluginsPort["useProjectKey"]>>();
  const get = vi.fn<PluginsPort["getProviderSettings"]>().mockResolvedValue(noKey);
  const save = vi.fn<PluginsPort["saveProviderSettings"]>();
  const first = renderCard({ getProviderSettings: get, saveProviderSettings: save, useProjectKey: attach });
  await waitFor(() => expect(first.result.current.card).toEqual(noKey));
  await act(async () => { expect(await first.result.current.useSavedKey()).toBe(false); });
  expect(attach).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledTimes(1);
  const second = renderCard({ getProviderSettings: async () => initialCard, saveProviderSettings: save });
  await waitFor(() => expect(second.result.current.card?.keyId).toBe("key-metrics"));
  await act(async () => { expect(await second.result.current.useSavedKey()).toBe(false); });
  expect(second.result.current.error).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it.each([
  { appliesAt: "restart", expected: true, message: undefined, error: null },
  { appliesAt: "failed", expected: false, message: "Reload failed", error: "Reload failed" },
  { appliesAt: "failed", expected: false, message: undefined, error: cannotStart },
] as const)("merges the key attachment result over the reread when application is $appliesAt ($message)", async ({ appliesAt, expected, message, error }) => {
  const refreshed: Card = { ...initialCard, fields: [{ ...initialCard.fields[0]!, value: "https://refreshed.test" }] };
  const usage = { keyId: "key-metrics", usedByThisSite: true, usedBy: ["preview", "current"], appliesAt, ...(message === undefined ? {} : { message }) };
  const getProviderSettings = vi.fn<PluginsPort["getProviderSettings"]>().mockResolvedValueOnce(initialCard).mockResolvedValueOnce(refreshed);
  const useProjectKey = vi.fn<NonNullable<PluginsPort["useProjectKey"]>>().mockResolvedValue(usage);
  const { result } = renderCard({ getProviderSettings, saveProviderSettings: vi.fn(), useProjectKey });
  await waitFor(() => expect(result.current.card).toEqual(initialCard));
  await act(async () => { expect(await result.current.useSavedKey()).toBe(expected); });
  expect(useProjectKey).toHaveBeenCalledExactlyOnceWith({ keyId: "key-metrics", use: true });
  expect(getProviderSettings.mock.calls).toEqual([[{ id: "metrics" }], [{ id: "metrics" }]]);
  expect(result.current.card).toEqual({ ...refreshed, ...usage });
  expect(result.current.values).toEqual({ endpoint: "https://refreshed.test" });
  expect(result.current.error).toBe(error);
  expect(result.current.saving).toBe(false);
});

it("describes an attachment refusal without rereading or altering the saved card", async () => {
  const getProviderSettings = vi.fn<PluginsPort["getProviderSettings"]>().mockResolvedValue(initialCard);
  const useProjectKey = vi.fn<NonNullable<PluginsPort["useProjectKey"]>>().mockRejectedValue("attachment refused");
  const { result } = renderCard({ getProviderSettings, saveProviderSettings: vi.fn(), useProjectKey });
  await waitFor(() => expect(result.current.card).toEqual(initialCard));
  await act(async () => { expect(await result.current.useSavedKey()).toBe(false); });
  expect(useProjectKey).toHaveBeenCalledExactlyOnceWith({ keyId: "key-metrics", use: true });
  expect(getProviderSettings).toHaveBeenCalledTimes(1);
  expect(result.current.card).toEqual(initialCard);
  expect(result.current.error).toBe("described(attachment refused|failed to save plugin settings)");
  expect(result.current.saving).toBe(false);
});

it("ignores a superseded settings read after switching plugin ids", async () => {
  const oldRead = deferred<Card>();
  const next = { ...initialCard, pluginId: "search", fields: [] };
  const port = { getProviderSettings: vi.fn<PluginsPort["getProviderSettings"]>(({ id }) => {
    if (id === "metrics") return oldRead.promise;
    if (id === "search") return Promise.resolve(next);
    throw new Error(`unexpected plugin ${id}`);
  }), saveProviderSettings: vi.fn<PluginsPort["saveProviderSettings"]>() };
  const { result, rerender } = renderHook(({ pluginId }) => usePluginProviderSettings({ pluginId, port, t, describeApiError }), {
    initialProps: { pluginId: "metrics" },
  });
  rerender({ pluginId: "search" });
  await waitFor(() => expect(result.current.card).toEqual(next));
  await act(async () => { oldRead.resolve(initialCard); });
  expect(result.current.card).toEqual(next);
  expect(result.current.values).toEqual({});
});
