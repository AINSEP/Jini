// @vitest-environment jsdom
import { cleanup, render, screen } from "../../../__tests__/fetch-query-support.js";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useSettlementGeneration } from "@jini-ai/ui/panel-kit";
import { AccessTokensTab, bindAccessTokensTab, type AccessTokensTabBindings } from "../AccessTokensTab.js";
import { useAccessTokens, type AccessTokensArgs } from "../hooks/use-access-tokens.hooks.js";
import { useMergedSecretsOrder, useRemoveConfirmDialog, useAddCustomCredentialDialog } from "../AccessTokensTab.hooks.js";
import { localizePublishTargets, localizeSourceControlProviders } from "../../../shell/lib/descriptor-i18n.js";

afterEach(cleanup);

const categories = [{ id: "all" as const, label: "All" }, { id: "hosting" as const, label: "Hosting" }];
const providerCopy = { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" };
const deps: AccessTokensArgs["deps"] = {
  ACCESS_TOKENS_RESOURCE: "credentials", ACCESS_TOKEN_CATEGORIES: categories, ACCESS_TOKEN_PROVIDER_COPY: providerCopy,
  LEGACY_SENTINEL_LABELS: { publish: "default", "source-control": "default" }, localizePublishTargets, localizeSourceControlProviders,
  sourceControlProviderInfoFromDescriptor: ({ descriptor }) => ({ id: descriptor.id, label: descriptor.label, tokenPageUrl: "", scopeGuidanceKey: "", fields: [] }),
  withPromotedDefault: vi.fn(), credentialDraftError: () => null,
  describeApiError: ({ e }) => String(e), isApiError: (_error): _error is import("@jini-ai/core/admin-runtime").AdminHttpError => false,
  translateCredentialMessage: ({ message }) => message, requiredFieldsFilled: () => true, suggestCredentialWorksFor: () => [],
  buildCredentialConnectionInput: vi.fn(), buildSourceControlConnectionInput: vi.fn(), accessTokenExistingRowReadyToSave: () => false,
  accessTokenRowReadyToSave: () => false, buildAccessTokenConnectionInput: vi.fn(), buildAccessTokenUpdatePatch: vi.fn(), classifyAccessTokenSubmitError: () => ({ kind: "generic" }),
};

it("requires the other-credentials hook on the bound tab", () => {
  expectTypeOf<Pick<Parameters<ReturnType<typeof bindAccessTokensTab>>[0], "useOtherCredentialsHook">>().toEqualTypeOf<{
    useOtherCredentialsHook: AccessTokensTabBindings["hooks"]["useOtherCredentialsHook"];
  }>();
});

it.each([true, false])("a forbidden store leaves healthy credentials and the failure notice visible (Tier 1 failure: %s)", async tier1Fails => {
  const credential = { credentialType: "vendor" as const, configured: true as const, accountLabel: null, id: "healthy", providerId: "host", label: "Healthy hosting key", isDefault: true, maskedToken: "tail", updatedAt: "2026-01-01", createdAt: "2026-01-01", worksFor: ["host"] };
  const port: AccessTokensArgs["port"] = {
    publish: { list: vi.fn(async () => ({ credentials: [credential], executionMode: "hosted-api-only" as const })), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    sourceControl: { list: vi.fn(async () => { if (tier1Fails) throw new Error("Source control forbidden"); return { credentials: [] }; }), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    custom: { list: vi.fn(async () => ({ credentials: [] })), create: vi.fn(), update: vi.fn(), remove: vi.fn(), useKey: vi.fn() },
    publishTargets: { list: vi.fn(async () => [{ id: "host", label: "Host", configFields: [], credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true }] } }]) },
    sourceControlProviders: { list: vi.fn(async () => tier1Fails ? [{ id: "source", label: "Source" }] : []) },
  };
  const store = { id: "site-assistant" as const, label: "Assistant", category: "ai" as const, purposeLabel: "AI", supportsReplace: true, screenLabel: "Manage", screenPath: "/assistant" };
  const otherRow = { key: "assistant", itemId: "site-assistant", store, name: "Healthy assistant key", valueFact: "tail", updatedAt: null, token: "", saving: false, error: null };
  const bindings: AccessTokensTabBindings = {
    hooks: {
      useAdminLocaleHook: () => "en",
      useAccessTokensHook: () => useAccessTokens({ port, locale: "en", t: key => key, deps, hooks: { useFetchQuery, useSettlementGeneration, useContentRefreshSubscription: () => {} } }),
      useOtherCredentialsHook: () => ({ groups: [{ store, rows: [otherRow] }], totalCount: 1, matchCount: 1,
        loadError: tier1Fails ? null : "Media forbidden", setDraftToken: vi.fn(), replace: vi.fn(), remove: vi.fn(), t: key => key }),
      useCopyKeysHook: vi.fn(), useMergedSecretsOrderHook: useMergedSecretsOrder,
      useRemoveConfirmDialogHook: useRemoveConfirmDialog, useAddCustomCredentialDialogHook: useAddCustomCredentialDialog,
      useTabBarKeyboardHook: () => ({ onKeyDown: vi.fn() }),
    },
    kit: { CredentialHint: () => null, OnboardingChipField: () => null,
      OtherCredentialEntry: ({ row }) => <button type="button">{row?.name}</button>,
      ConnectedMarkIcon: () => null, DisclosureChevronIcon: () => null, SearchIcon: () => null },
    deps: {
      ACCESS_TOKEN_CATEGORIES: categories, ACCESS_TOKEN_PROVIDER_COPY: providerCopy, showCopyKeysEntry: false, viewerTimeZone: "UTC",
      removeLabel: "Remove stored copy", removeTokenHandleLabel: ({ provider }) => `Remove ${provider}`, storedTokenNotice: "Stored encrypted.", hostingPluginsHref: "/plugins",
      providerGroupHandleLabel: () => "Hosting credentials", tokenRowHandleLabel: ({ name }) => name,
      fieldNameHandleSegment: ({ fieldName }) => fieldName, fieldHelpText: () => "", accessTokenExtraFieldIdSuffix: ({ fieldName }) => fieldName,
      resolveTabBarTabIndex: () => 0, otherCredentialMatchesQuery: () => true,
      accessTokensCountText: ({ totalCount }) => `${totalCount} tokens saved`, removeDialogTitle: () => "Remove stored copy", removeDialogBody: () => "Remove this stored copy?",
    },
  };
  render(<AccessTokensTab {...bindings} />);
  expect(await screen.findByText("Healthy hosting key")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Healthy assistant key" })).not.toBeDisabled();
  expect(screen.getByText(tier1Fails ? /Source control forbidden/ : "Media forbidden")).toBeTruthy();
  expect(screen.queryByText("Loading access tokens…")).toBeNull();
  expect(screen.queryByText("Not connected")).toBeNull();
  expect(screen.getByRole("searchbox")).toBeTruthy();
});
