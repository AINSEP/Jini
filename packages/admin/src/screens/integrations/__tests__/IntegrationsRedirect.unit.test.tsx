// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { IntegrationsRedirect } from "../IntegrationsRedirect.js";
import { useIntegrationsRedirect as useIntegrationsRedirectWithDefault } from "../hooks/use-integrations-redirect.hooks.js";
import { useRouteLocation } from "../../../shell/lib/router.js";

const HOST_LEGACY_DEFAULT = "/addons/integrations?tab=webhooks";
/** The host adapter: supplies the host's legacy default destination the way the host app does. */
function useIntegrationsRedirect({ routePath }: { routePath?: string | undefined } = {}): void {
  useIntegrationsRedirectWithDefault({ routePath, defaultRoutePath: HOST_LEGACY_DEFAULT });
}

afterEach(() => window.history.replaceState(null, "", "/"));

// F2.1/F2.4: deleting the component's hook mount, dropping ?tab=webhooks, or pushing history
// must fail. No router/hook mock: observe the URL and the production route subscription.
it("mounting the retired screen replaces its URL with the Webhooks tab and notifies the router", () => {
  window.history.replaceState(null, "", "/admin/integrations");
  const historyLength = window.history.length;
  const subscriber = renderHook(() => useRouteLocation());
  expect(subscriber.result.current).toBe("/integrations");
  const { container, rerender } = render(<IntegrationsRedirect useIntegrationsRedirectHook={useIntegrationsRedirect} />);
  expect(window.location.pathname).toBe("/admin/addons/integrations");
  expect(window.location.search).toBe("?tab=webhooks");
  expect(window.history.length).toBe(historyLength);
  expect(subscriber.result.current).toBe("/addons/integrations?tab=webhooks");
  expect(container).toBeEmptyDOMElement();

  window.history.replaceState(null, "", "/admin/media");
  rerender(<IntegrationsRedirect useIntegrationsRedirectHook={useIntegrationsRedirect} />);
  expect(window.location.pathname).toBe("/admin/media");
  expect(window.history.length).toBe(historyLength);
});

it("the redirect hook replaces history when mounted independently", () => {
  window.history.replaceState(null, "", "/admin/integrations?tab=mcp-server");
  const historyLength = window.history.length;
  renderHook(() => useIntegrationsRedirect());
  expect(window.location.pathname).toBe("/admin/addons/integrations");
  expect(window.location.search).toBe("?tab=webhooks");
  expect(window.history.length).toBe(historyLength);
});

it("uses the resolved destination and updates it when the same redirect component receives a new route", () => {
  window.history.replaceState(null, "", "/admin/plugins?tab=add");
  const historyLength = window.history.length;
  const { rerender } = render(<IntegrationsRedirect routePath="/addons/plugins?tab=add" useIntegrationsRedirectHook={useIntegrationsRedirect} />);
  expect(window.location.pathname + window.location.search).toBe("/admin/addons/plugins?tab=add");
  rerender(<IntegrationsRedirect routePath="/addons/integrations/sub%2F1?cursor=a%2Bb" useIntegrationsRedirectHook={useIntegrationsRedirect} />);
  expect(window.location.pathname + window.location.search).toBe("/admin/addons/integrations/sub%2F1?cursor=a%2Bb");
  expect(window.history.length).toBe(historyLength);
});

it("delegates the redirect to the injected useIntegrationsRedirectHook instead of navigating itself", () => {
  window.history.replaceState(null, "", "/admin/integrations");
  const useIntegrationsRedirectHook = vi.fn();
  render(<IntegrationsRedirect routePath="/integrations" useIntegrationsRedirectHook={useIntegrationsRedirectHook} />);
  expect(useIntegrationsRedirectHook).toHaveBeenCalledWith({ routePath: "/integrations" });
  expect(window.location.pathname).toBe("/admin/integrations");
});
