import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Security, type SecurityProps } from "../Security.js";

afterEach(cleanup);

test("direct site-key entry and a permission downgrade hide both its button and body", () => {
  let canManageSiteKey = false;
  const SiteKey = vi.fn(() => <div>Site key body</div>);
  const props: SecurityProps = {
    tabId: "site-key",
    useAdminLocaleHook: () => "en",
    useSecurityPermissionsHook: () => ({ canManageSiteKey }),
    kit: {
      TabBar: ({ tabs, activeId, onChange }) => <div>{tabs.map(tab => <button key={tab.id} aria-pressed={activeId === tab.id} onClick={() => onChange(tab.id)}>{tab.label}</button>)}</div>,
      AccessTokensIcon: () => null,
      SiteKeyIcon: () => null,
    },
    panels: {
      AccessTokens: () => <div>Access tokens body</div>, SiteKey,
      Totp: () => <div>Totp card</div>, RecoveryCodes: () => <div>Recovery card</div>, Passkeys: () => <div>Passkeys card</div>,
    },
    copy: {
      t: ({ key }) => key,
      headerHandleLabel: "Secrets header",
      accessTokensHandleLabel: "Switch credentials",
    },
    onTabChange: vi.fn(),
  };
  const view = render(<Security {...props} />);
  expect(view.queryByRole("button", { name: "Site key" })).toBeNull();
  expect(view.queryByText("Site key body")).toBeNull();
  expect(SiteKey).not.toHaveBeenCalled();
  expect(view.getByText("Access tokens body")).toBeTruthy();
  canManageSiteKey = true;
  view.rerender(<Security {...props} />);
  expect(view.getByRole("button", { name: "Site key" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.getByText("Site key body")).toBeTruthy();
  canManageSiteKey = false;
  view.rerender(<Security {...props} />);
  expect(view.queryByRole("button", { name: "Site key" })).toBeNull();
  expect(view.queryByText("Site key body")).toBeNull();
  expect(view.getByText("Access tokens body")).toBeTruthy();
});
