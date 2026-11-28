// @vitest-environment jsdom
import { renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import { localizePublishTargets, localizeSourceControlProviders } from "../../../shell/lib/descriptor-i18n.js";
import { bindAccessTokens, type AccessTokensArgs } from "../hooks/use-access-tokens.hooks.js";

/**
 * @file `bindAccessTokens`: the zero-argument wired hook binds the real port and a translator tied to
 * the host's resolved locale, stable across renders until that locale changes.
 */

function wiredHook() {
  const port: AccessTokensArgs["port"] = {
    publish: { list: vi.fn(async () => ({ credentials: [], executionMode: "hosted-api-only" as const })), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    sourceControl: { list: vi.fn(async () => ({ credentials: [] })), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    custom: { list: vi.fn(async () => ({ credentials: [] })), create: vi.fn(), update: vi.fn(), remove: vi.fn(), useKey: vi.fn() },
    publishTargets: { list: vi.fn(async () => [{ id: "host", label: "Host", configFields: [], credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true }] } }]) },
    sourceControlProviders: { list: vi.fn(async () => []) },
  };
  const defaultT = vi.fn(({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`);
  const locale = { current: "es" };
  const useWiredAccessTokens = bindAccessTokens({
    port,
    hooks: { useFetchQuery, useSettlementGeneration, useContentRefreshSubscription: () => {}, useLocaleHook: () => locale.current },
    deps: {
      defaultT,
      ACCESS_TOKENS_RESOURCE: "credentials", ACCESS_TOKEN_CATEGORIES: [{ id: "all", label: "All" }, { id: "hosting", label: "Hosting" }],
      ACCESS_TOKEN_PROVIDER_COPY: { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" },
      LEGACY_SENTINEL_LABELS: { publish: "default", "source-control": "default" }, localizePublishTargets, localizeSourceControlProviders,
      sourceControlProviderInfoFromDescriptor: ({ descriptor }) => ({ id: descriptor.id, label: descriptor.label, tokenPageUrl: "", scopeGuidanceKey: "", fields: [] }),
      withPromotedDefault: vi.fn(), credentialDraftError: () => null,
      describeApiError: ({ e }) => String(e), isApiError: (_error): _error is AdminHttpError => false,
      translateCredentialMessage: ({ message }) => message, requiredFieldsFilled: () => true, suggestCredentialWorksFor: () => [],
      buildCredentialConnectionInput: vi.fn(), buildSourceControlConnectionInput: vi.fn(), accessTokenExistingRowReadyToSave: () => false,
      accessTokenRowReadyToSave: () => false, buildAccessTokenConnectionInput: vi.fn(), buildAccessTokenUpdatePatch: vi.fn(), classifyAccessTokenSubmitError: () => ({ kind: "generic" }),
    },
  });
  return { port, defaultT, locale, useWiredAccessTokens };
}

describe("bindAccessTokens", () => {
  it("loads through the bound port and translates in the host's resolved locale", async () => {
    const { port, defaultT, useWiredAccessTokens } = wiredHook();
    const hook = renderHook(() => useWiredAccessTokens());
    await waitFor(() => expect(hook.result.current.groups?.map((group) => group.info.providerId)).toEqual(["host"]));
    expect(port.publish.list).toHaveBeenCalled();
    expect(port.custom.list).toHaveBeenCalled();
    expect(hook.result.current.t("Save")).toBe("es:Save");
    expect(defaultT).toHaveBeenLastCalledWith({ locale: "es", key: "Save" });
  });

  it("keeps one translator across renders and binds a new one only when the locale changes", async () => {
    const { locale, useWiredAccessTokens } = wiredHook();
    const hook = renderHook(() => useWiredAccessTokens());
    await waitFor(() => expect(hook.result.current.groups).not.toBeUndefined());
    const first = hook.result.current.t;
    hook.rerender();
    expect(hook.result.current.t).toBe(first);
    locale.current = "de";
    hook.rerender();
    expect(hook.result.current.t).not.toBe(first);
    expect(hook.result.current.t("Save")).toBe("de:Save");
  });
});
