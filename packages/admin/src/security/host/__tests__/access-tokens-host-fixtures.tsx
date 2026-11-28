import { vi } from "vitest";
import { SecretInput } from "../../../shell/components/SecretInput/SecretInput.js";
import { useAddCustomCredentialDialog, useMergedSecretsOrder, useRemoveConfirmDialog } from "../AccessTokensTab.hooks.js";
import type { AccessTokensTabBindings } from "../AccessTokensTab.js";
import type { AccessTokenProviderInfo } from "../../access-token-providers.js";
import type { AccessTokenRow } from "../../access-token-rows.js";
import type {
  AccessTokenAddFormState, AccessTokenExistingRowState, AccessTokenProviderGroupState, AccessTokensController,
} from "../hooks/use-access-tokens.hooks.js";
import type { OtherCredentialsController } from "../hooks/use-other-credentials.hooks.js";
import type { CopyKeysController } from "../hooks/use-copy-keys.hooks.js";

/**
 * @file Shared fixtures for the Access Tokens host component tests. The controllers are the
 * components' injected ports: plain objects whose methods are spies, so a test can assert the exact
 * request a click or keystroke delivers. The tab's own hooks (`useMergedSecretsOrder`, the two dialog
 * hooks) and the host `SecretInput` are the real ones; the remaining kit slots are small fakes that
 * render what they were given.
 */

/** jsdom has no `<dialog>` modal API; this stand-in toggles `open` the way the browser does. */
export function installDialogStandIn(): () => void {
  const proto = HTMLDialogElement.prototype;
  const original = { showModal: Object.getOwnPropertyDescriptor(proto, "showModal"), close: Object.getOwnPropertyDescriptor(proto, "close") };
  Object.defineProperty(proto, "showModal", { configurable: true, writable: true, value: function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(proto, "close", { configurable: true, writable: true, value: function close(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  return () => {
    for (const name of ["showModal", "close"] as const) {
      const descriptor = original[name];
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
  };
}

export const CATEGORIES = [
  { id: "all" as const, label: "All" },
  { id: "hosting" as const, label: "Hosting" },
  { id: "source-control" as const, label: "Source control" },
  { id: "ai" as const, label: "AI" },
];

export function providerInfo(over: Partial<AccessTokenProviderInfo> = {}): AccessTokenProviderInfo {
  return {
    kind: "publish", providerId: "host", label: "Host Pages", vendorLabel: "Host Inc", purposeLabel: "Hosting",
    category: "hosting", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [], ...over,
  };
}

export function tokenRow(over: Partial<AccessTokenRow> = {}): AccessTokenRow {
  return {
    kind: "publish", providerId: "host", id: "row-1", name: "Deploy bot", rawLabel: "Deploy bot", isDefault: true,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-03T04:05:00Z", ...over,
  };
}

export function rowState(row: Partial<AccessTokenRow> = {}, fields: Partial<Omit<AccessTokenExistingRowState, "row">> = {}): AccessTokenExistingRowState {
  const built = tokenRow(row);
  return { row: built, name: built.name, token: "", values: {}, username: "", worksFor: [], readyToSave: false, saving: false, error: null, ...fields };
}

export function addFormState(over: Partial<AccessTokenAddFormState> = {}): AccessTokenAddFormState {
  return { visible: false, name: "", token: "", values: {}, username: "", worksFor: [], readyToSave: false, saving: false, error: null, ...over };
}

export function providerGroup(info: AccessTokenProviderInfo, rows: AccessTokenExistingRowState[] = [], addForm: Partial<AccessTokenAddFormState> = {}): AccessTokenProviderGroupState {
  return { info, rows, addForm: addFormState(addForm) };
}

export function fakeController(over: Partial<AccessTokensController> = {}): AccessTokensController {
  return {
    groups: [], worksForOptions: [{ value: "host", label: "Host" }, { value: "docs", label: "Docs" }], loadError: null,
    query: "", setQuery: vi.fn(), category: "all", setCategory: vi.fn(), totalCount: 0, matchCount: 0,
    setExistingField: vi.fn(), replaceToken: vi.fn(async () => {}), removeToken: vi.fn(async () => {}), makeDefault: vi.fn(async () => {}),
    openAddForm: vi.fn(), closeAddForm: vi.fn(), setAddField: vi.fn(), createToken: vi.fn(async () => {}),
    customAddForm: { name: "", category: "hosting", baseUrl: "", additionalHosts: "", token: "", username: "", worksFor: [], saving: false, error: null },
    setCustomAddField: vi.fn(), resetCustomAddForm: vi.fn(), createCustomCredential: vi.fn(async () => true),
    customKeyBusy: {}, setCustomKeyUse: vi.fn(async () => {}), t: (key: string) => key, ...over,
  };
}

export function fakeOtherController(over: Partial<OtherCredentialsController> = {}): OtherCredentialsController {
  return { groups: [], loadError: null, totalCount: 0, matchCount: 0, setDraftToken: vi.fn(), replace: vi.fn(), remove: vi.fn(), t: (key: string) => key, ...over };
}

export function fakeCopyKeys(over: Partial<CopyKeysController> = {}): CopyKeysController {
  return { open: false, show: vi.fn(), ...over } as unknown as CopyKeysController;
}

/** A chip field fake: one checkbox per option, toggling the value list it was given. */
function ChipField({ label, options, value, onChange }: { multiple: true; label: string; options: { value: string; label: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  return <fieldset aria-label={`chips ${label}`}>{options.map((option) => (
    <label key={option.value}>
      <input type="checkbox" checked={value.includes(option.value)}
        onChange={() => onChange(value.includes(option.value) ? value.filter((id) => id !== option.value) : [...value, option.value])} />
      {option.label}
    </label>
  ))}</fieldset>;
}

export function tabBindings(over: { deps?: Partial<AccessTokensTabBindings["deps"]>; hooks?: Partial<AccessTokensTabBindings["hooks"]> } = {}): AccessTokensTabBindings {
  return {
    hooks: {
      useAdminLocaleHook: () => "en",
      useAccessTokensHook: () => fakeController(),
      useOtherCredentialsHook: () => fakeOtherController(),
      useCopyKeysHook: () => fakeCopyKeys(),
      useMergedSecretsOrderHook: useMergedSecretsOrder,
      useRemoveConfirmDialogHook: useRemoveConfirmDialog,
      useAddCustomCredentialDialogHook: useAddCustomCredentialDialog,
      useTabBarKeyboardHook: () => ({ onKeyDown: vi.fn() }),
      ...over.hooks,
    },
    kit: {
      SecretInput,
      CredentialHint: ({ hint }) => <span data-testid="hint">{hint ? `hint ${hint.last4}` : "no hint"}</span>,
      OnboardingChipField: ChipField,
      OtherCredentialEntry: ({ store, row }) => <p>{`other ${store.id}: ${row?.name ?? "none"}`}</p>,
      ConnectedMarkIcon: () => null, DisclosureChevronIcon: () => null, SearchIcon: () => null,
    },
    deps: {
      asciiSlug: ({ text }) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ACCESS_TOKEN_CATEGORIES: CATEGORIES,
      ACCESS_TOKEN_PROVIDER_COPY: { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" },
      showCopyKeysEntry: false, viewerTimeZone: "UTC", removeLabel: "Remove stored copy",
      customCredentialBaseUrlPlaceholder: "https://api.example.test", removeTokenHandleLabel: ({ provider }) => `Remove ${provider}`,
      storedTokenNotice: "Stored encrypted.", hostingPluginsHref: "/plugins?filter=hosting",
      providerGroupHandleLabel: ({ info, connectedCount }) => `${info.label} (${connectedCount})`,
      tokenRowHandleLabel: ({ name, providerLabel }) => `${name} for ${providerLabel}`,
      fieldNameHandleSegment: ({ fieldName }) => fieldName,
      fieldHelpText: ({ field }) => (field.name === "account" ? "Your account number." : ""),
      accessTokenExtraFieldIdSuffix: ({ fieldName }) => `field-${fieldName}`,
      resolveTabBarTabIndex: ({ activeId, tab }) => (tab.id === activeId ? 0 : -1),
      otherCredentialMatchesQuery: ({ store, query }) => store.label.toLowerCase().includes(query.trim().toLowerCase()),
      accessTokensCountText: ({ totalCount, matchCount, query }) => `${matchCount}/${totalCount} for "${query}"`,
      removeDialogTitle: ({ locale, name }) => `title(${locale}) ${name}`,
      removeDialogBody: ({ locale, credentialLabel, vendor }) => `body(${locale}) ${credentialLabel} at ${vendor}`,
      ...over.deps,
    },
  };
}
