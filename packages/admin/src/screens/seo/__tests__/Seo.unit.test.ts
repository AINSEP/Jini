import { isValidElement, type ReactNode } from "react";
import { expect, it } from "vitest";

import { Seo, type SeoModulePanelHook } from "../index.js";

/**
 * @file The SEO panel mounts the host's module page with the injected module-panel hook: the `seo`
 * settings page, the requested tab carried in the route query, and the host's loading view.
 */

function Loading(): ReactNode { return null; }

function recordingHook(calls: Array<Parameters<SeoModulePanelHook>>): SeoModulePanelHook {
  return (props, optional) => { calls.push([props, optional]); return { content: "mounted" }; };
}

it("mounts the seo settings page with the requested tab and the host loading view", () => {
  const calls: Array<Parameters<SeoModulePanelHook>> = [];
  expect(Seo({ tabId: "sitemap", useModulePanel: recordingHook(calls), ModuleLoading: Loading })).toBe("mounted");
  const [props, optional] = calls[0] ?? [];
  expect(props?.moduleId).toBe("seo");
  expect(props?.pageId).toBe("settings");
  expect(props?.route.view).toBeNull();
  expect(props?.route.query.get("tab")).toBe("sitemap");
  const loading = optional?.loadingContent;
  expect(isValidElement(loading) && loading.type === Loading).toBe(true);
});

it("leaves the tab out of the query when none is requested", () => {
  const calls: Array<Parameters<SeoModulePanelHook>> = [];
  Seo({ tabId: null, useModulePanel: recordingHook(calls), ModuleLoading: Loading });
  expect(calls[0]?.[0].route.query.has("tab")).toBe(false);
});
