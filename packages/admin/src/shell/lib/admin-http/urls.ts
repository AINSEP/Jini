import { BASE, WORKSPACE_ID } from "./config.js";

export function authenticatedAdminUrl({ path }: { path: string }, _optional: Record<string, never> = {}): string {
  return `${BASE}${path}`;
}

/** A Sites card's preview image (`GET .../system/sites/:name/preview`, same-origin cookie auth like
 *  every admin read). The version is in the URL so one URL's bytes never change and the server can
 *  let the browser cache them indefinitely; a new capture is a new URL. */
export function adminSitePreviewUrl({ name, version }: { name: string; version: number }, _optional: Record<string, never> = {}): string {
  return authenticatedAdminUrl({ path: `/workspaces/${WORKSPACE_ID}/system/sites/${encodeURIComponent(name)}/preview?v=${encodeURIComponent(String(version))}` });
}
