import { describe, expect, it, vi } from "vitest";

/**
 * @file Coverage for `media-providers-port.ts` — the host's real `MediaProviderRowsPort`.
 *
 * The two functions' error-handling contracts are opposite by design (the file's own header spells
 * out why): `fetchMediaProviders` swallows every failure into `null` — never `{}` — so a transient
 * network blip can never read as "the server manages nothing" and wipe local edits;
 * the per-provider writes reject on failure, since the tab renders that rejection as its own
 * `save-error` state. Both branches of that asymmetry are asserted here.
 */

const { getMediaProviders, applyMediaProviderChanges, patchMediaProvider, removeMediaProvider } = vi.hoisted(() => ({
  getMediaProviders: vi.fn(),
  applyMediaProviderChanges: vi.fn(),
  patchMediaProvider: vi.fn(),
  removeMediaProvider: vi.fn(),
}));

import type { MediaRequestFn } from "../api/media-api.js";
import { createMediaApi } from "../api/media-api.js";
import { createMediaProvidersPort } from "../media-providers-port.js";
import { WORKSPACE_ID } from "@jini-ai/admin/shell/lib/admin-http/config";

const mediaProvidersPort = createMediaProvidersPort({ mediaApi: { getMediaProviders, applyMediaProviderChanges, patchMediaProvider, removeMediaProvider } });

describe("mediaProvidersPort.fetchMediaProviders", () => {
  it("returns the provider map on success", async () => {
    const map = { cloudinary: { apiKeyConfigured: true, apiKeyTail: "1234" } };
    getMediaProviders.mockResolvedValue(map);
    await expect(mediaProvidersPort.fetchMediaProviders()).resolves.toEqual(map);
  });

  it("resolves null (NEVER {}, never rejects) when the server is unreachable — protects local edits from a transient blip", async () => {
    getMediaProviders.mockRejectedValue(new Error("network down"));
    await expect(mediaProvidersPort.fetchMediaProviders()).resolves.toBeNull();
  });

  it("resolves null the same way for a 500/403-shaped failure, not just a network error", async () => {
    getMediaProviders.mockRejectedValue(new Error("403 Forbidden"));
    await expect(mediaProvidersPort.fetchMediaProviders()).resolves.toBeNull();
  });
});

/**
 * The writes go through the real `createMediaApi` down to an injected `request`, so these pin what
 * actually travels: one provider's fields to its own row, never a whole map whose omissions would delete.
 */
describe("mediaProvidersPort per-provider writes", () => {
  const authoritative = { openai: { apiKeyConfigured: true, apiKeyTail: "0001" }, grok: { apiKeyConfigured: true, apiKeyTail: "0002" } };
  const rowPath = (providerId: string) => `/workspaces/${WORKSPACE_ID}/media/providers/${encodeURIComponent(providerId)}`;
  const wiredPort = () => {
    const request = vi.fn();
    const mediaApi = createMediaApi({ request: request as unknown as MediaRequestFn, siteUrl: ({ path }) => path });
    return { request, mediaApi, port: createMediaProvidersPort({ mediaApi }) };
  };

  it("is the per-provider port: there is no whole-map save left to infer deletion from omission", () => {
    const { mediaApi, port } = wiredPort();
    expect("saveMediaProviders" in port).toBe(false);
    expect("saveMediaProviders" in mediaApi).toBe(false);
    expect(typeof port.patchProvider).toBe("function");
    expect(typeof port.removeProvider).toBe("function");
  });

  it("saving one provider does not wipe a built-in key saved in another window", async () => {
    const { request, port } = wiredPort();
    request.mockResolvedValue(authoritative);
    await expect(port.patchProvider({ providerId: "grok", fields: { apiKey: "xai-window-b" } })).resolves.toEqual(authoritative);
    expect(request).toHaveBeenCalledTimes(1);
    const [target, options] = request.mock.calls[0]!;
    expect(target).toEqual({ path: rowPath("grok") });
    expect(options.init.method).toBe("PATCH");
    // Only grok's own fields travel; openai (saved elsewhere, unknown to this tab) is never named.
    expect(JSON.parse(options.init.body)).toEqual({ apiKey: "xai-window-b" });
  });

  it("Remove on a plugin-vendor key deletes that key and nothing else", async () => {
    const { request, port } = wiredPort();
    request.mockResolvedValue(authoritative);
    await expect(port.removeProvider({ providerId: "acme/media" })).resolves.toEqual(authoritative);
    expect(request).toHaveBeenCalledTimes(1);
    const [target, options] = request.mock.calls[0]!;
    expect(target).toEqual({ path: rowPath("acme/media") });
    expect(options.init).toEqual({ method: "DELETE" });
  });

  it("sends removals and patches in one batch and returns the authoritative provider map", async () => {
    const { request, port } = wiredPort();
    const reply = { openai: { apiKeyConfigured: true, apiKeyTail: "0001", model: "canonical" } };
    request.mockResolvedValue(reply);
    await expect(port.applyProviderChanges({ removes: ["grok"], patches: [{ providerId: "openai", fields: { model: "new" } }] })).resolves.toEqual(reply);
    expect(request).toHaveBeenCalledTimes(1);
    const [target, options] = request.mock.calls[0]!;
    expect(target).toEqual({ path: `/workspaces/${WORKSPACE_ID}/media/providers` });
    expect(options.init.method).toBe("PATCH");
    expect(JSON.parse(options.init.body)).toEqual({ removes: ["grok"], patches: [{ providerId: "openai", fields: { model: "new" } }] });
  });

  it("REJECTS on failure, unlike fetchMediaProviders — the tab renders this as its save-error state", async () => {
    patchMediaProvider.mockRejectedValue(new Error("no site key"));
    removeMediaProvider.mockRejectedValue(new Error("no site key"));
    await expect(mediaProvidersPort.patchProvider({ providerId: "openai", fields: { model: "m" } })).rejects.toThrow("no site key");
    await expect(mediaProvidersPort.removeProvider({ providerId: "openai" })).rejects.toThrow("no site key");
  });

  it("forwards exactly the named provider and its fields to the injected media API", async () => {
    patchMediaProvider.mockResolvedValue(authoritative);
    removeMediaProvider.mockResolvedValue(authoritative);
    await expect(mediaProvidersPort.patchProvider({ providerId: "grok", fields: { baseUrl: "https://x.test" } })).resolves.toEqual(authoritative);
    await expect(mediaProvidersPort.removeProvider({ providerId: "grok" })).resolves.toEqual(authoritative);
    expect(patchMediaProvider).toHaveBeenCalledWith({ providerId: "grok", fields: { baseUrl: "https://x.test" } });
    expect(removeMediaProvider).toHaveBeenCalledWith({ providerId: "grok" });
  });
});
