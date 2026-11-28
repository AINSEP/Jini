import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Translate } from "@jini-ai/core/text";
import { bindSecurity, Security, type SecurityBindingProps, type SecurityProps } from "../Security.js";

afterEach(cleanup);

const kit: SecurityProps["kit"] = {
  TabBar: ({ tabs, activeId, onChange }) => (
    <div>{tabs.map(tab => <button key={tab.id} aria-pressed={activeId === tab.id} onClick={() => onChange(tab.id)}>{tab.label}</button>)}</div>
  ),
  AccessTokensIcon: () => null,
  SiteKeyIcon: () => null,
};

const copy: SecurityProps["copy"] = {
  t: ({ locale, key }) => `${locale}:${key}`,
  headerHandleLabel: "Secrets header",
  accessTokensHandleLabel: "Switch credentials",
};

function panels(): SecurityProps["panels"] {
  return {
    AccessTokens: () => <div>Access tokens body</div>,
    SiteKey: () => <div>Site key body</div>,
    Totp: ({ translate }: { translate: Translate }) => <p>{translate("Authenticator app")}</p>,
    RecoveryCodes: ({ t }: { t: Translate }) => <p>{t("Recovery codes")}</p>,
    Passkeys: ({ translate }: { translate: Translate }) => <p>{translate("Passkeys")}</p>,
  };
}

test("the second-factor cards translate through the page copy in the admin's locale", () => {
  const view = render(
    <Security useAdminLocaleHook={() => "fr"} useSecurityPermissionsHook={() => ({ canManageSiteKey: false })}
      kit={kit} panels={panels()} copy={copy} onTabChange={vi.fn()} />,
  );
  expect(view.getByText("fr:Authenticator app")).toBeTruthy();
  expect(view.getByText("fr:Recovery codes")).toBeTruthy();
  expect(view.getByText("fr:Passkeys")).toBeTruthy();
  expect(view.getByRole("heading", { level: 1 }).textContent).toBe("fr:Secrets");
});

test("picking a tab reports the chosen tab id to the host", () => {
  const onTabChange = vi.fn();
  const view = render(
    <Security useAdminLocaleHook={() => "en"} useSecurityPermissionsHook={() => ({ canManageSiteKey: true })}
      kit={kit} panels={panels()} copy={copy} onTabChange={onTabChange} />,
  );
  expect(view.getByRole("button", { name: "en:Access Tokens" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "en:Site key" }));
  expect(onTabChange).toHaveBeenCalledExactlyOnceWith({ nextTabId: "site-key" }, {});
  // The page itself does not switch: the host owns the tab id and passes it back in.
  expect(view.getByText("Access tokens body")).toBeTruthy();
  expect(view.queryByText("Site key body")).toBeNull();
});

function bind() {
  const hooks = {
    useAdminLocaleHook: () => "en",
    useSecurityPermissionsHook: () => ({ canManageSiteKey: true }),
    useAccessTokensHook: vi.fn(),
    useSiteKeyHook: vi.fn(),
  } satisfies Parameters<typeof bindSecurity>[0]["hooks"];
  const createPanels = vi.fn((_required: Parameters<Parameters<typeof bindSecurity>[0]["deps"]["createPanels"]>[0]) => panels());
  const onTabChange = vi.fn();
  const BoundSecurity = bindSecurity({ hooks, kit, deps: { createPanels, copy, onTabChange } });
  return { hooks, createPanels, onTabChange, BoundSecurity };
}

test("a bound page with no overrides builds its panels from the bound hooks and omits the token hook", () => {
  const { hooks, createPanels, BoundSecurity } = bind();
  const view = render(<BoundSecurity />);
  expect(createPanels).toHaveBeenCalledOnce();
  const required = createPanels.mock.calls[0]![0];
  expect(required).toEqual({ useSiteKeyHook: hooks.useSiteKeyHook, useAdminLocaleHook: hooks.useAdminLocaleHook });
  expect("useAccessTokensHook" in required).toBe(false);
  // No tabId: the page lands on Access Tokens even though the principal may manage the site key.
  expect(view.getByText("Access tokens body")).toBeTruthy();
  expect(view.getByRole("button", { name: "en:Access Tokens" }).getAttribute("aria-pressed")).toBe("true");
});

test("per-render token, site-key and locale overrides reach both the panel factory and the page", () => {
  const { createPanels, onTabChange, BoundSecurity } = bind();
  const useSiteKeyHook = vi.fn() as unknown as NonNullable<SecurityBindingProps["useSiteKeyHook"]>;
  const useAccessTokensHook = vi.fn() as unknown as NonNullable<SecurityBindingProps["useAccessTokensHook"]>;
  const useAdminLocaleHook = () => "de";
  const view = render(<BoundSecurity tabId="site-key" useAccessTokensHook={useAccessTokensHook} useSiteKeyHook={useSiteKeyHook} useAdminLocaleHook={useAdminLocaleHook} />);
  expect(createPanels).toHaveBeenCalledExactlyOnceWith({ useAccessTokensHook, useSiteKeyHook, useAdminLocaleHook });
  expect(view.getByText("Site key body")).toBeTruthy();
  expect(view.getByText("de:Authenticator app")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "de:Access Tokens" }));
  expect(onTabChange).toHaveBeenCalledExactlyOnceWith({ nextTabId: "access-tokens" }, {});
});

test("a bound page honours a permissions override over the bound one", () => {
  const { BoundSecurity } = bind();
  const view = render(<BoundSecurity tabId="site-key" useSecurityPermissionsHook={() => ({ canManageSiteKey: false })} />);
  expect(view.queryByRole("button", { name: "en:Site key" })).toBeNull();
  expect(view.queryByText("Site key body")).toBeNull();
  expect(view.getByText("Access tokens body")).toBeTruthy();
});
