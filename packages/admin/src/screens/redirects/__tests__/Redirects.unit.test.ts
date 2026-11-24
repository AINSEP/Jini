import { isValidElement, type ReactNode } from "react";
import { expect, it } from "vitest";

import { Redirects, type RedirectsModulePanelHook } from "../index.js";

/**
 * @file The Redirects panel mounts the host's module page with the injected module-panel hook: the
 * `redirects` list page with an empty route, and the host's loading view.
 */

function Loading(): ReactNode { return null; }

it("mounts the redirects list page with an empty route and the host loading view", () => {
  const calls: Array<Parameters<RedirectsModulePanelHook>> = [];
  const useModulePanel: RedirectsModulePanelHook = (props, optional) => { calls.push([props, optional]); return { content: "mounted" }; };
  expect(Redirects({ useModulePanel, ModuleLoading: Loading })).toBe("mounted");
  const [props, optional] = calls[0] ?? [];
  expect(props?.moduleId).toBe("redirects");
  expect(props?.pageId).toBe("list");
  expect(props?.route.view).toBeNull();
  expect(props?.route.params).toEqual({});
  expect([...(props?.route.query.keys() ?? [])]).toEqual([]);
  const loading = optional?.loadingContent;
  expect(isValidElement(loading) && loading.type === Loading).toBe(true);
});
