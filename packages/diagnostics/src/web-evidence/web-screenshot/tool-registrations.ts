import { toolMetadata } from "@jini-ai/core/tool-metadata/web-screenshot";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";

import type { ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { AgentToolDefinition } from "./agent-tools.js";

interface WebScreenshotInput {
  target: { kind: "url"; url: string } | { kind: "site"; path: string };
  viewport: "desktop" | "tablet" | "mobile";
  fullPage: boolean; waitMs: number; dismissCookieBanners?: boolean; themeId?: string;
}
type OpenOwnSite = (required?: {}, optional?: { themeId?: string }) => Promise<{ origin: string; close(): Promise<void> }>;
type SaveCaptureFiles = (required: { files: readonly { relPath: string; bytes: Buffer }[] }) => Promise<string[]>;
interface WebScreenshotService {
  screenshot(required: { input: WebScreenshotInput; openOwnSite?: OpenOwnSite; saveCaptureFiles?: SaveCaptureFiles }, optional?: { signal?: AbortSignal }): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: "image/jpeg"; data: string }> }>;
}

/**
 * @file Maps the `web-screenshot` catalog onto {@link createWebScreenshotService}. The handler gates
 * on the same permission the catalog declares (one evaluator, at the handler, per ADR-021 §2).
 *
 * One service per contributor, so the daemon and BYOK surfaces in one process share one browser and
 * one queue. The own-site opener needs the booted site's deps, so the host passes a factory that
 * turns `routeDeps` into one (`openLoopbackSiteServer` over `RouteDeps.createSiteApp`).
 */

const DOMAIN = "web-screenshot";

export const webScreenshotDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> one headless page load whose every request goes through the egress guard (or this site's own
  // per-call loopback render), plus an image encode. Writes nothing to the site: the only write is
  // the capture JPEGs into `<siteDir>/.captures/` (agent artifacts, see capture-files.ts).
  ["web_screenshot_page", "none"],
]);

export interface WebScreenshotToolDeps { workspaceId: string; authorize: AuthorizeFn }

export function buildWebScreenshotRegistrations(
  { routeDeps, service, catalog, permission, readInput }: { routeDeps: WebScreenshotToolDeps; service: WebScreenshotService;
    catalog: readonly AgentToolDefinition[]; permission: string; readInput: (required: { input: Readonly<Record<string, unknown>> }) => WebScreenshotInput },
  { openOwnSite, saveCaptureFiles }: { openOwnSite?: OpenOwnSite; saveCaptureFiles?: SaveCaptureFiles } = {},
): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    ["web_screenshot_page"]: async (ctx) => {
      const input = readInput({ input: requireInputRecord({ input: ctx.input }) });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission }, { entityType: "web-page" });
      return service.screenshot({ input, ...(openOwnSite ? { openOwnSite } : {}), ...(saveCaptureFiles ? { saveCaptureFiles } : {}) }, ctx.signal ? { signal: ctx.signal } : {});
    },
  };
  return buildDomainRegistrations({ metadata: toolMetadata, domain: DOMAIN, catalogModule: "features/web-screenshot/agent-tools.ts", catalog: indexCatalogById({ catalog }), handlers, derivedRisk: webScreenshotDerivedRisk });
}

/**
 * Contributes `web_screenshot_page` — called once by `tool-catalog-manifest.ts`'s
 * `installFirstPartyToolContributors()`, which owns the guarded client and the Playwright adapter.
 * Nothing launches at registration; Chromium starts on the first call.
 * @param required.ports - Capture adapter, tile encoder, clock and optional observer.
 * @param optional.openOwnSiteFor - Builds the own-site opener from the booted site's deps; omitted, `sitePath` is refused.
 * @param optional.saveCaptureFilesFor - Builds the capture writer for the booted site's folder; omitted, captures are not saved.
 */
export function contributeWebScreenshotTools<TDeps extends WebScreenshotToolDeps = WebScreenshotToolDeps>(
  { service, catalog, permission, readInput }: Omit<Parameters<typeof buildWebScreenshotRegistrations>[0], "routeDeps">,
  { openOwnSiteFor, saveCaptureFilesFor }: {
    openOwnSiteFor?: (routeDeps: TDeps) => OpenOwnSite;
    saveCaptureFilesFor?: (routeDeps: TDeps) => SaveCaptureFiles;
  } = {},
): ToolContributor<TDeps, unknown> {
  return {
    domain: DOMAIN,
    build: (routeDeps) => buildWebScreenshotRegistrations({ routeDeps, service, catalog, permission, readInput }, {
      ...(openOwnSiteFor ? { openOwnSite: openOwnSiteFor(routeDeps) } : {}),
      ...(saveCaptureFilesFor ? { saveCaptureFiles: saveCaptureFilesFor(routeDeps) } : {}),
    }),
    risk: webScreenshotDerivedRisk,
  };
}
