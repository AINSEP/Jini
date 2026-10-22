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

type HostKind = "netlify" | "vercel";
interface ExportContext {
  oracle: RedirectTargetOracle;
  reservedSegments: ReadonlySet<string>;
  host: HostKind;
  winners: Map<string, RedirectRecord>;
  dynamicOverrides: RedirectRecord[];
}
type EmissionVerdict = { kind: "emitted"; rule: RedirectRecord } | { kind: "refused"; refusal: HostRedirectRefusal };

const ABSOLUTE_TARGET = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i;
const CAPTURE_TOKEN = /\$\d+/;

/** Refusals for rules whose match is not a single literal path.
 * @complexity O(pattern + target length). No effects.
 */
function matchShapeRefusal(rule: RedirectRecord, reservedSegments: ReadonlySet<string>): HostRedirectRefusalReason | null {
  if (rule.matchType !== "exact" && CAPTURE_TOKEN.test(rule.toTarget) && ABSOLUTE_TARGET.test(rule.toTarget)) return "interpolated-absolute-target";
  // Prefix tails and wildcard captures are unbounded input. A static file cannot re-run INV-03
  // after interpolation: even /safe/$1 can become /safe/../admin through encoded dot segments.
  // Netlify splats also accept empty/multi-segment input that the root '*' never matches.
  if (rule.matchType === "prefix") return "dynamic-target-requires-runtime-oracle";
  if (rule.matchType !== "exact" || !isLiteralHostPath(rule, reservedSegments)) return "host-match-would-widen";
  return null;
}

/** Refusals for a literal rule's destination that the host would reinterpret.
 * @complexity O(target length). No effects.
 */
function targetSyntaxRefusal(toTarget: string): HostRedirectRefusalReason | null {
  // A destination token cannot be delegated to a host's unrelated capture/template language.
  if (CAPTURE_TOKEN.test(toTarget) || /[:$][a-z0-9_{]/i.test(toTarget.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""))) return "host-template-syntax";
  if (!ABSOLUTE_TARGET.test(toTarget) && !toTarget.startsWith("/")) return "host-template-syntax";
  return null;
}

/** Decide representation limits before any configuration is emitted.
 * @complexity O(pattern + target length). No effects.
 */
function representationRefusal(rule: RedirectRecord, reservedSegments: ReadonlySet<string>, host: HostKind): HostRedirectRefusalReason | null {
  const shape = matchShapeRefusal(rule, reservedSegments);
  if (shape !== null) return shape;
  // Vercel redirects always precede its filesystem. A post-content rule would override live
  // content there; Netlify's non-forced redirect retains the filesystem fallback semantics.
  if (host === "vercel" && !rule.override) return "host-phase-would-widen";
  return targetSyntaxRefusal(rule.toTarget);
}

/** Pick the runtime winner between two active rules sharing one source pattern.
 * @complexity O(1) matcher work for the pair. No effects.
 */
function pairWinner(previous: RedirectRecord, rule: RedirectRecord): RedirectRecord {
  // pre_content runs first: an override winner takes precedence over any post-content rule,
  // regardless of their relative priorities. Within a phase the root matcher owns ordering.
  const pair = [previous, rule];
  const preContent = pair.filter(candidate => candidate.override);
  const resolution = match({
    request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "post_content" },
    rules: preContent.length > 0 ? preContent : pair,
  }, {});
  return resolution.matched && resolution.redirectId === rule.id ? rule : previous;
}

/** Winner per source pattern, chosen just as the root matcher would.
 * @complexity O(n) pair resolutions. O(n) space.
 */
function selectWinners(active: readonly RedirectRecord[]): Map<string, RedirectRecord> {
  // Winners must be chosen before validating exportability. Exporting a lower-priority fallback
  // when the runtime's winner is unsafe would invent behavior the runtime explicitly refuses.
  const winners = new Map<string, RedirectRecord>();
  for (const rule of active) {
    const previous = winners.get(rule.fromPattern);
    winners.set(rule.fromPattern, previous ? pairWinner(previous, rule) : rule);
  }
  return winners;
}

/** Whether a refused-or-not dynamic override owns this literal's path before content.
 * @complexity O(m log m) for m dynamic overrides.
 */
function displacedByDynamicOverride(rule: RedirectRecord, dynamicOverrides: RedirectRecord[]): boolean {
  if (rule.override || dynamicOverrides.length === 0) return false;
  // A refused dynamic override can still own this runtime path before content. Emitting a
  // post-content literal in its place would invent a different target. This static scan costs
  // O(n*m log m); it runs at export time, never on the request path.
  return match({ request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "pre_content" }, rules: dynamicOverrides }, {}).matched;
}

/** Static refusal for one rule, before any oracle read.
 * @complexity O(pattern + target length) plus the dynamic-override scan.
 */
function staticRefusal(rule: RedirectRecord, context: ExportContext): HostRedirectRefusalReason | null {
  if (rule.status !== "active") return "inactive-rule";
  if (context.winners.get(rule.fromPattern) !== rule) return "shadowed-rule";
  const representation = representationRefusal(rule, context.reservedSegments, context.host);
  if (representation !== null) return representation;
  return displacedByDynamicOverride(rule, context.dynamicOverrides) ? "shadowed-rule" : null;
}

/** Oracle-check the finished Location of a statically exportable rule.
 * @complexity O(target length) plus one oracle read.
 */
async function verifyEmission(rule: RedirectRecord, context: ExportContext): Promise<EmissionVerdict> {
  const refused = (reason: HostRedirectRefusalReason): EmissionVerdict => ({ kind: "refused", refusal: { redirectId: rule.id, reason } });
  // INV-03: use the root matcher even for a literal export. Only its finished Location is
  // oracle-checked; configuration must never rely on a verdict about an unexpanded template.
  const resolution = match({ request: { workspaceId: rule.workspaceId, path: rule.fromPattern, phase: "post_content" }, rules: [rule] }, {});
  if (!resolution.matched) return refused("host-match-would-widen");
  try {
    const verdict = await checkRedirectLocation({
      context: { workspaceId: rule.workspaceId }, location: resolution.location, oracle: context.oracle, reservedSegments: context.reservedSegments,
    }, {});
    return verdict.kind === "refused" ? refused(verdict.reason) : { kind: "emitted", rule: { ...rule, toTarget: resolution.location } };
  } catch {
    // Export is a batch decision: one unavailable oracle does not hide the refusal or abort
    // the report for other rules. No raw infrastructure message is exposed in the result.
    return refused("oracle-error");
  }
}

/** Select exact-rule winners just as the root matcher does, and retain every refusal.
 * @complexity O(n log n) for literal rules; O(n*m log m) with m dynamic override rules, plus pattern and oracle cost. O(n) space.
 */
async function exportableRules(required: HostRedirectRequired, host: HostKind): Promise<{ rules: RedirectRecord[]; refused: HostRedirectRefusal[] }> {
  const { rules, oracle, reservedSegments } = required;
  if (new Set(rules.map(rule => rule.workspaceId)).size > 1) {
    return { rules: [], refused: rules.map(rule => ({ redirectId: rule.id, reason: "mixed-workspaces" })) };
  }
  const active = rules.filter(rule => rule.status === "active");
  const context: ExportContext = {
    oracle, reservedSegments, host,
    winners: selectWinners(active),
    dynamicOverrides: active.filter(rule => rule.override && rule.matchType !== "exact"),
  };
  const refused: HostRedirectRefusal[] = [];
  const emitted: RedirectRecord[] = [];
  for (const rule of rules) {
    const reason = staticRefusal(rule, context);
    const verdict: EmissionVerdict = reason === null ? await verifyEmission(rule, context) : { kind: "refused", refusal: { redirectId: rule.id, reason } };
    if (verdict.kind === "refused") refused.push(verdict.refusal);
    else emitted.push(verdict.rule);
  }
  // selectWinners keeps one rule per fromPattern, so no two emitted rules ever compare equal.
  emitted.sort((a, b) => a.fromPattern < b.fromPattern ? -1 : 1);
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
