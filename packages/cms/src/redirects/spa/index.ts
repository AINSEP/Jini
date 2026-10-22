/** Framework-free SPA navigation through the same matcher and INV-03 gate as server resolution. */
import { redirectMatcher } from "../matcher.js";
import { InMemoryRedirectRepo } from "../repo.memory.js";
import { createRedirectResolver } from "../resolver.js";
import type { RedirectTargetOracle } from "../target-gate.js";
import type { RedirectResolutionReport } from "../ports.js";
import type { RedirectRecord, RedirectRequest, RedirectStatusCode } from "../types.js";

export interface SpaRedirectRequired {
  rules: readonly RedirectRecord[];
  oracle: RedirectTargetOracle;
  reservedSegments: ReadonlySet<string>;
  navigate(required: { location: string; statusCode: RedirectStatusCode; redirectId: string }, optional?: Record<string, never>): void | Promise<void>;
}
export interface SpaRedirectResult extends RedirectResolutionReport { navigated: boolean }
export type SpaRedirectGuard = (required: { request: RedirectRequest }, optional?: Record<string, never>) => Promise<SpaRedirectResult>;

/**
 * Create a router guard from a snapshot of rules and required host security/navigation ports.
 * @param required Rules, verified-origin oracle, reserved segments and navigation effect.
 * @returns A guard reporting no match or refusal; only a gate-approved finished Location navigates.
 * @throws Repository/oracle errors and navigation errors propagate to the router's error boundary.
 * @complexity O(n) rule snapshot; calls inherit the root memory repo and bounded dynamic scan.
 * @example const guard = createSpaRedirectGuard({ rules, oracle, reservedSegments, navigate }, {});
 * await guard({ request: { workspaceId: "site", path: "/old", phase: "post_content" } }, {});
 */
export function createSpaRedirectGuard(
  { rules, oracle, reservedSegments, navigate }: SpaRedirectRequired,
  _optional: Record<string, never> = {},
): SpaRedirectGuard {
  const repo = new InMemoryRedirectRepo({ seed: [...rules] }, {});
  const resolver = createRedirectResolver({ repo, matcher: redirectMatcher, originRegistry: oracle, reservedSegments }, {});
  return async ({ request }, _options = {}) => {
    const report = await resolver.resolveWithRefusals(request, {});
    if (!report.resolution.matched) return { ...report, navigated: false };
    const { location, statusCode, redirectId } = report.resolution;
    // INV-03: resolver checks the interpolated Location before this effect is reachable.
    await navigate({ location, statusCode, redirectId }, {});
    return { ...report, navigated: true };
  };
}
