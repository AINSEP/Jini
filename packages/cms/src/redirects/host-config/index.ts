/** Static host configuration: emit only rules whose match and security verdict stay invariant. */
import { checkSiteRelativeTarget } from "@jini-ai/http-kit/verified-origin";
import { match } from "../matcher.js";
import { checkRedirectLocation, type RedirectLocationRefusalReason, type RedirectTargetOracle } from "../target-gate.js";
import type { RedirectRecord, RedirectStatusCode } from "../types.js";

export interface HostRedirectRequired {
  rules: readonly RedirectRecord[];
  oracle: RedirectTargetOracle;
  reservedSegments: ReadonlySet<string>;
}
export type HostRedirectRefusalReason = RedirectLocationRefusalReason
  | "oracle-error" | "inactive-rule" | "mixed-workspaces" | "shadowed-rule"
  | "host-match-would-widen" | "dynamic-target-requires-runtime-oracle"
  | "interpolated-absolute-target" | "host-template-syntax" | "host-phase-would-widen";
export interface HostRedirectRefusal { redirectId: string; reason: HostRedirectRefusalReason }
export interface VercelRedirect { source: string; destination: string; statusCode: RedirectStatusCode }
export interface HostRedirectExport<T> { emitted: T; refused: HostRedirectRefusal[] }

/** Only literal source paths with no host pattern tokens, encoding or URL normalization changes.
 * @complexity O(source length). The URL parser and the shared host path check own normalization.
 */
function isLiteralHostPath(rule: RedirectRecord, reservedSegments: ReadonlySet<string>): boolean {
  if (!/^\/[a-z0-9_./~-]*$/i.test(rule.fromPattern)) return false;
  const parsed = new URL(rule.fromPattern, "https://host-config.invalid");
  if (parsed.pathname !== rule.fromPattern) return false;
  return checkSiteRelativeTarget({ raw: rule.fromPattern, reservedSegments }, {}).kind === "ok";
}

/** Decide representation limits before any configuration is emitted.
 * @complexity O(pattern + target length). No effects.
 */
function representationRefusal(rule: RedirectRecord, reservedSegments: ReadonlySet<string>, host: "netlify" | "vercel"): HostRedirectRefusalReason | null {
  const hasCaptures = /\$\d+/.test(rule.toTarget);
  const absolute = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(rule.toTarget);
  if (rule.matchType !== "exact" && hasCaptures && absolute) return "interpolated-absolute-target";
  // Prefix tails and wildcard captures are unbounded input. A static file cannot re-run INV-03
  // after interpolation: even /safe/$1 can become /safe/../admin through encoded dot segments.
  // Netlify splats also accept empty/multi-segment input that the root '*' never matches.
  if (rule.matchType === "prefix") return "dynamic-target-requires-runtime-oracle";
  if (rule.matchType !== "exact" || !isLiteralHostPath(rule, reservedSegments)) return "host-match-would-widen";
  // Vercel redirects always precede its filesystem. A post-content rule would override live
  // content there; Netlify's non-forced redirect retains the filesystem fallback semantics.
  if (host === "vercel" && !rule.override) return "host-phase-would-widen";
  // A destination token cannot be delegated to a host's unrelated capture/template language.
  if (hasCaptures || /[:$][a-z0-9_{]/i.test(rule.toTarget.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""))) return "host-template-syntax";
  if (!absolute && !rule.toTarget.startsWith("/")) return "host-template-syntax";
  return null;
}

/** Select exact-rule winners just as the root matcher does, and retain every refusal.
 * @complexity O(n log n) for literal rules; O(n*m log m) with m dynamic override rules, plus pattern and oracle cost. O(n) space.
 */
async function exportableRules(required: HostRedirectRequired, host: "netlify" | "vercel"): Promise<{ rules: RedirectRecord[]; refused: HostRedirectRefusal[] }> {
  const { rules, oracle, reservedSegments } = required;
  const refused: HostRedirectRefusal[] = [];
  if (new Set(rules.map(rule => rule.workspaceId)).size > 1) {
    return { rules: [], refused: rules.map(rule => ({ redirectId: rule.id, reason: "mixed-workspaces" })) };
  }
  const active = rules.filter(rule => rule.status === "active");
  // Winners must be chosen before validating exportability. Exporting a lower-priority fallback
  // when the runtime's winner is unsafe would invent behavior the runtime explicitly refuses.
  const winners = new Map<string, RedirectRecord>();
  for (const rule of active) {
    const previous = winners.get(rule.fromPattern);
    if (!previous) {
      winners.set(rule.fromPattern, rule);
      continue;
    }
    // pre_content runs first: an override winner takes precedence over any post-content rule,
    // regardless of their relative priorities. Within a phase the root matcher owns ordering.
    const pair = [previous, rule];
    const preContent = pair.filter(candidate => candidate.override);
    const resolution = match({
      request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "post_content" },
      rules: preContent.length > 0 ? preContent : pair,
    }, {});
    if (resolution.matched && resolution.redirectId === rule.id) winners.set(rule.fromPattern, rule);
  }
  const dynamicOverrides = active.filter(rule => rule.override && rule.matchType !== "exact");
  const emitted: RedirectRecord[] = [];
  for (const rule of rules) {
    let reason: HostRedirectRefusalReason | null = null;
    if (rule.status !== "active") reason = "inactive-rule";
    else if (winners.get(rule.fromPattern) !== rule) reason = "shadowed-rule";
    else reason = representationRefusal(rule, reservedSegments, host);
    if (reason === null && !rule.override && dynamicOverrides.length > 0) {
      // A refused dynamic override can still own this runtime path before content. Emitting a
      // post-content literal in its place would invent a different target. This static scan costs
      // O(n*m log m); it runs at export time, never on the request path.
      const earlier = match({ request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "pre_content" }, rules: dynamicOverrides }, {});
      if (earlier.matched) reason = "shadowed-rule";
    }
    if (reason !== null) {
      refused.push({ redirectId: rule.id, reason });
      continue;
    }
    // INV-03: use the root matcher even for a literal export. Only its finished Location is
    // oracle-checked; configuration must never rely on a verdict about an unexpanded template.
    const resolution = match({ request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "post_content" }, rules: [rule] }, {});
    if (!resolution.matched) {
      refused.push({ redirectId: rule.id, reason: "host-match-would-widen" });
      continue;
    }
    try {
      const verdict = await checkRedirectLocation({
        context: { workspaceId: rule.workspaceId }, location: resolution.location, oracle, reservedSegments,
      }, {});
      if (verdict.kind === "refused") refused.push({ redirectId: rule.id, reason: verdict.reason });
      else emitted.push({ ...rule, toTarget: resolution.location });
    } catch {
      // Export is a batch decision: one unavailable oracle does not hide the refusal or abort
      // the report for other rules. No raw infrastructure message is exposed in the result.
      refused.push({ redirectId: rule.id, reason: "oracle-error" });
    }
  }
  emitted.sort((a, b) => a.fromPattern < b.fromPattern ? -1 : a.fromPattern > b.fromPattern ? 1 : 0);
  return { rules: emitted, refused };
}

/**
 * Render an _redirects file with every unrepresentable/unsafe rule reported explicitly.
 * @param required Rules, required verified-origin oracle and host-owned reserved segments.
 * @returns File contents and all refusals. Override rules retain Netlify's force marker.
 * @complexity O(n log n + output length) for literal rules; dynamic overrides add O(n*m log m). O(n + output length) space, plus oracle reads.
 * @example await toNetlifyRedirects({ rules, oracle, reservedSegments }, {});
 */
export async function toNetlifyRedirects(required: HostRedirectRequired, _optional: Record<string, never> = {}): Promise<HostRedirectExport<string>> {
  const result = await exportableRules(required, "netlify");
  const lines = result.rules.map(rule => `${rule.fromPattern} ${rule.toTarget} ${rule.statusCode}${rule.override ? "!" : ""}`);
  return { emitted: lines.length === 0 ? "" : `${lines.join("\n")}\n`, refused: result.refused };
}

/**
 * Render the redirects member of vercel.json; post-content rules are explicitly refused.
 * @param required Rules, required verified-origin oracle and host-owned reserved segments.
 * @returns Configuration and all refusals; status codes are preserved, including 301/302.
 * @complexity O(n log n + output length) for literal rules; dynamic overrides add O(n*m log m). O(n) output space, plus oracle reads.
 * @example await toVercelRedirects({ rules, oracle, reservedSegments }, {});
 */
export async function toVercelRedirects(required: HostRedirectRequired, _optional: Record<string, never> = {}): Promise<HostRedirectExport<{ redirects: VercelRedirect[] }>> {
  const result = await exportableRules(required, "vercel");
  return {
    emitted: { redirects: result.rules.map(rule => ({ source: rule.fromPattern, destination: rule.toTarget, statusCode: rule.statusCode })) },
    refused: result.refused,
  };
}
