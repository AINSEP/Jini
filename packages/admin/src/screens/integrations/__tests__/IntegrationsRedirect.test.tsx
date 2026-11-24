// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrationsRedirect } from "../IntegrationsRedirect.js";

afterEach(cleanup);

it("renders nothing and delegates the redirect to the injected hook with the route path", () => {
  const useIntegrationsRedirectHook = vi.fn();
  const { container } = render(<IntegrationsRedirect routePath="/integrations" useIntegrationsRedirectHook={useIntegrationsRedirectHook} />);
  expect(container.innerHTML).toBe("");
  expect(useIntegrationsRedirectHook).toHaveBeenCalledWith({ routePath: "/integrations" });
});

it("passes an undefined route path through so the host hook applies its own default", () => {
  const useIntegrationsRedirectHook = vi.fn();
  render(<IntegrationsRedirect useIntegrationsRedirectHook={useIntegrationsRedirectHook} />);
  expect(useIntegrationsRedirectHook).toHaveBeenCalledWith({ routePath: undefined });
});
