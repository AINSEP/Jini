import type { FederationRefusalMessages } from "./messages.js";
import type { FederatedAdmissionReport, ToolRefusalReason } from "./trust.js";
import { federatedToolId } from "./trust.js";

/**
 * @file The refusal channel's SECOND sink: the one that reaches the model.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes
 * ---------------------------------------------------------------------------
 * `trust.ts` already refuses nothing silently — `admitRemoteTools` returns a complete accounting,
 * and `bootstrap.ts`'s `logFederatedAdmissionReport` writes every line of it. But a log is a sink
 * with exactly one reader: whoever happened to be tailing the daemon's terminal at the moment it
 * booted. Two parties who needed that accounting never got it:
 *
 * 1. THE OPERATOR, who allowed a tool for a connection and watched it not work. Served
 * since by `federation-admissions-route.ts` and its admin proxy — a structured read
 * of this same snapshot.
 * 2. THE MODEL, which is this file. Asked in chat why it could not generate an image, the assistant
 * INVENTED a cause, because a refused tool is simply absent: it is never registered, so
 * `search_tools` cannot find it, `describe_tool` cannot describe it, and nothing anywhere in the
 * catalog says "this exists and was withheld." Absence is indistinguishable from non-existence,
 * and a model asked to explain an absence with no evidence will produce a plausible sentence.
 *
 * A tool-shaped fix does not work here, and that is the whole reason this is prompt text. A model
 * that does not know it is missing anything never calls the tool that would tell it. The refusal
 * has to arrive without a discovery step, which means the prompt.
 *
 * ---------------------------------------------------------------------------
 * Why this is safe to prepend to every run
 * ---------------------------------------------------------------------------
 * R-A. NOTHING IS SAID WHEN NOTHING IS WRONG. A boot with no actionable refusal returns `""` and
 * costs zero tokens — the overwhelmingly common case, and the reason this is not gated behind
 * an env arm the way `capability-manifest-prefix.ts` is.
 *
 * R-B. `not-in-operator-allowlist` IS NOT REPORTED. It is the routine default-deny outcome of R2:
 * a real server advertises tens of tools and an operator allowlists three, so this reason
 * fires for every tool nobody asked for. Reporting it would put a wall of "you did not enable
 * this" in front of the model on every turn and train it to ignore the whole block — the same
 * failure `bootstrap.ts`'s `resolveRegisteredPresets` cites for staying silent about a preset
 * that simply is not configured. What IS reported is every refusal where the operator's own
 * intent and the gate's decision disagree.
 *
 * R-C. THE REMOTE'S BYTES ARE NEVER TRUSTED. A refused `remoteName` is third-party text on a direct
 * path into the system prompt, and `invalid-remote-tool-name` is BY DEFINITION the refusal
 * whose name failed {@link SAFE_REMOTE_NAME} — arbitrary attacker-chosen bytes. Every name
 * here is re-checked against that pattern and replaced with a description rather than escaped
 * when it fails, matching `trust.ts`'s own "refused rather than escaped, because every escaping
 * scheme is a place to get it wrong later" for the identical reason one layer earlier.
 *
 * R-D. THE CHANNEL IS BOUNDED. A remote that advertises a thousand malformed tools cannot spend the
 * model's context window through this file: the item list is capped and the omission is
 * announced with the true total, so the model is never told a smaller number than the truth.
 * Same discipline as `wrapUntrustedResult`'s announced truncation.
 *
 * R-E. NOTHING CALLABLE IS EVER REPORTED AS WITHHELD. A refused `remoteName` whose name is also in
 * `admitted` is dropped — see {@link refusalItems} for the case that produces one and why the
 * subtraction is by admitted set rather than by refusal reason.
 *
 * Architectural role:
 * Pure functions. No I/O, no registry, no protocol — the same posture as `trust.ts`, and for the
 * same reason: every rule above is a unit test.
 * See docs/decisions/DR-001-federation-admission.md.
 */

/** One connection's boot admission accounting, exactly as `AttachFederatedToolsResult.reports`
 *  carries it and `federation-admissions-route.ts` serves it. Restated structurally rather than
 *  imported from `bootstrap.ts`: that module performs I/O and spawns child processes on import,
 *  and this file's whole point is being a pure reduction over the snapshot. */
export interface FederationAdmissionSnapshotEntry {
  readonly connectionId: string;
  readonly report: FederatedAdmissionReport;
}

/** What KIND of disagreement between operator intent and the gate's decision an item records.
 *  Three, not one, because the operator fix differs for each: a refusal needs a grant, an absent
 *  allowlist entry needs a correction, and an inert write grant needs a second listing. */
export type FederationRefusalKind = "refused" | "allowlisted-but-absent" | "write-allowed-but-not-allowlisted";

/** One thing the operator asked for that the running assistant does not have. */
export interface FederationRefusalItem {
  readonly connectionId: string;
  /** Already sanitized per R-C — safe to render and safe to put in a prompt. */
  readonly remoteName: string;
  readonly kind: FederationRefusalKind;
  /** `null` for the two drift kinds, which are not gate refusals. */
  readonly reason: ToolRefusalReason | null;
  /** Operator-actionable prose: what happened AND what to do about it. Never a placeholder — a
   *  reason with no real fix is a reported refusal that is still useless. */
  readonly explanation: string;
}

/** R-C's gate, deliberately identical to `trust.ts`'s `REMOTE_TOOL_NAME_PATTERN`. Kept as its own
 *  literal rather than imported: that constant is private to the trust tier and exporting it to
 *  make a prompt-safety check reuse it would widen a security module's surface for a consumer that
 *  only needs the same ANSWER, not the same binding. The two must not drift — a name this file
 *  accepts that the gate would reject is a prompt-injection hole — which is why the equivalence is
 *  its own test rather than a comment. */
const SAFE_REMOTE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/** R-D's cap. Enough that a real misconfiguration is fully listed, small enough that a hostile
 *  server cannot buy prompt real estate by advertising junk. */
const MAX_ITEMS_IN_PREFIX = 10;

/**
 * R-C. A rejected name is replaced without quoting a single remote-chosen byte.
 * Returns a name safe to place in a prompt, or {@link FederationRefusalMessages.unprintableName}.
 *
 * @complexity O(n) in the name length, bounded by the pattern's own 64-character ceiling.
 */
export function safeRemoteName({ remoteName, messages }: { remoteName: unknown; messages: FederationRefusalMessages }): string {
  if (typeof remoteName !== "string") return messages.unprintableName;
  return SAFE_REMOTE_NAME.test(remoteName) ? remoteName : messages.unprintableName;
}

/**
 * The operator-facing sentence for each refusal reason: what the gate did, and the one thing that
 * changes it. Routine default-deny is excluded from boot enumeration per R-B, but an
 * attempted tool still needs its specific refusal explained.
 *
 * Host wording names the concrete remediation; the reducer must not assume a UI or labels.
 *
 * The routine default-deny explanation is included for attempts — see R-B. Needed here
 * because ATTEMPT-TIME reporting (`../federated-refusal-diagnosis.ts`) is not enumeration: R-B's
 * "not news" argument only holds for a boot-time list the model reads whether it asked or not. A
 * model that has actually NAMED this exact tool id in a call has, by doing so, already decided it
 * wants it — telling it why that specific call failed is never the spam R-B guards against.
 *
 * The full per-reason explanation for a caller that already knows WHICH tool was attempted — as
 * opposed to {@link refusalItems}'s boot-time enumeration, which drops `not-in-operator-allowlist`
 * per R-B. Every other reason's text is the exact same string {@link FederationRefusalMessages.refusalExplanations} gives the
 * boot prefix, so the two channels can never disagree about WHY a given reason code fired — only
 * about which reasons are worth mentioning unprompted.
 *
 * @complexity O(1).
 */
export function explainFederatedToolRefusal({ reason, messages }: { reason: ToolRefusalReason; messages: FederationRefusalMessages }): string {
  return messages.refusalExplanations[reason];
}

/**
 * One connection's gate refusals, minus R-B's routine default-deny and minus R-E's names that were
 * admitted anyway.
 *
 * R-E. A NAME PRESENT IN `admitted` IS NEVER REPORTED AS WITHHELD (2026-09-07, MCP-01). A refused
 *      `remoteName` is not the same thing as an absent tool: `trust.ts`'s `admitRemoteToolName`
 *      admits the FIRST descriptor of a name and refuses only the REPEAT, so a server that
 *      advertises `image_lookup` twice puts that one name into `admitted` AND into `refused`. Every
 *      sentence {@link FederationRefusalMessages.prefixInstruction} attaches to an item — "NOT in `search_tools`",
 *      "`describe_tool` cannot describe them", "calling them is impossible" — is then false, and the
 *      model was told so on every turn for the life of the process, about a tool it can call. That
 *      is the invented-cause failure this whole file exists to prevent, produced by this file.
 *
 *      Subtracting the ADMITTED SET rather than special-casing `duplicate-remote-tool-name` is
 *      deliberate: the property that makes an item true is "the model cannot call this", and the
 *      admitted set is what answers that directly. A reason-based skip would state the same rule in
 *      terms that stop being equivalent the moment the gate grows another refusal an admitted name
 *      can also collect. A duplicate whose name was NOT admitted (both descriptors refused) is
 *      still reported, correctly — the operator-facing admission report already computes unavailable names this same way, and this
 *      brings the model-facing arm to the accounting the operator-facing one already had.
 *
 * Per connection, never global: a federated tool id is namespaced by `connectionId`, so
 * `vendor:image_lookup` being callable says nothing about `other-vendor:image_lookup`.
 */
function refusalItems(entry: FederationAdmissionSnapshotEntry, messages: FederationRefusalMessages): FederationRefusalItem[] {
  const admittedNames = new Set(entry.report.admitted.map((tool) => tool.remoteName));
  const items: FederationRefusalItem[] = [];
  // One combined `continue` rather than two, and a loop rather than `filter().map()`: falling past
  // this guard is what narrows `refusal.reason` out of `not-in-operator-allowlist`, even though
  // the host messages also carry that reason for attempt-time diagnosis. A `filter` predicate cannot narrow the element
  // type for a following `map`, so that shape needs a cast to compile — a cast standing in for a
  // guarantee the control flow already provides.
  for (const refusal of entry.report.refused) {
    if (refusal.reason === "not-in-operator-allowlist" || admittedNames.has(refusal.remoteName)) continue;
    items.push({
      connectionId: entry.connectionId,
      remoteName: safeRemoteName({ remoteName: refusal.remoteName, messages: messages }),
      kind: "refused",
      reason: refusal.reason,
      explanation: messages.refusalExplanations[refusal.reason],
    });
  }
  return items;
}

/** One connection's two config-drift lists — `trust.ts`'s own `allowlistedButAbsent` /
 *  `writeAllowedButNotAllowlisted`, which exist precisely so config that can never take effect is
 *  reported rather than silently inert. This file is where that reporting finally reaches a reader
 *  who is not tailing a terminal. */
function driftItems(entry: FederationAdmissionSnapshotEntry, messages: FederationRefusalMessages): FederationRefusalItem[] {
  const absent = entry.report.allowlistedButAbsent.map((name): FederationRefusalItem => ({
    connectionId: entry.connectionId,
    remoteName: safeRemoteName({ remoteName: name, messages: messages }),
    kind: "allowlisted-but-absent",
    reason: null,
    explanation: messages.absentExplanation,
  }));
  const inert = entry.report.writeAllowedButNotAllowlisted.map((name): FederationRefusalItem => ({
    connectionId: entry.connectionId,
    remoteName: safeRemoteName({ remoteName: name, messages: messages }),
    kind: "write-allowed-but-not-allowlisted",
    reason: null,
    explanation: messages.inertWriteGrantExplanation,
  }));
  return [...absent, ...inert];
}

/**
 * Every place this boot's admitted set disagrees with what the operator asked for.
 *
 * Shared by the prompt prefix below and by any operator-facing consumer that wants the same
 * accounting as data rather than prose — one derivation, so the two can never disagree about which
 * refusals count, the same property `classifyRemoteToolSurface` gives `trust.ts`.
 *
 * @param snapshot - `AttachFederatedToolsResult.reports`, verbatim.
 * @returns Items in connection order, refusals before drift within each connection.
 * @complexity O(c · t) in connections and their admitted/refused/drift entries — the per-connection
 * admitted-name set R-E subtracts against is built once per connection, not per refusal.
 * See docs/decisions/DR-001-federation-admission.md.
 */
export function summarizeFederatedRefusals({ snapshot, messages }: { snapshot: readonly FederationAdmissionSnapshotEntry[]; messages: FederationRefusalMessages }
): readonly FederationRefusalItem[] {
  return snapshot.flatMap((entry) => [...refusalItems(entry, messages), ...driftItems(entry, messages)]);
}

/** One refused federated tool CALL, resolved by the exact id a caller attempted — the call-time
 *  counterpart to {@link FederationRefusalItem}, which is one row of the boot-time enumeration.
 *  Deliberately its own shape rather than a reused `FederationRefusalItem`: this one ALWAYS carries
 *  an explanation (R-B does not apply to an attempt — see {@link explainFederatedToolRefusal}), and
 *  it is resolved from one id on demand rather than built by iterating every refusal up front. */
export interface FederatedToolRefusalLookup {
  readonly connectionId: string;
  /** Already sanitized per R-C — safe to render and safe to put in a message a model reads. */
  readonly remoteName: string;
  readonly reason: ToolRefusalReason;
  readonly explanation: string;
}

/**
 * Resolves ONE attempted tool id against a boot's admission snapshot, for the caller that actually
 * tried to run it — the call-time half of "every refusal is reportable, never silent" (R-B only ever
 * silences the boot-time ENUMERATION of a routine default-deny, never an attempt naming the tool by
 * id).
 *
 * Matches by re-minting {@link federatedToolId} for every refused `(connectionId, remoteName)` pair
 * rather than parsing `toolId` apart: the mint is the one place that format is defined, and a second,
 * independent parser is a second place the two could silently drift.
 *
 * @param toolId - The exact id a call attempted, e.g. `mcp__higgsfield__tiktok_publish`.
 * @param snapshot - `AttachFederatedToolsResult.reports`, verbatim — the same shape
 *   {@link summarizeFederatedRefusals} accepts.
 * @returns `null` when `toolId` is not a federated id this boot ever refused — either it was
 *   admitted (a caller reaching this function for an admitted id is a bug one layer up: an admitted
 *   tool is registered and its call would never throw `unknown tool` in the first place), or it is
 *   not a federated tool id this boot knows about at all (a native tool, or a genuinely
 *   unknown/hallucinated one).
 * @complexity O(c · r) in connections and their refusals — the same bound
 *   {@link summarizeFederatedRefusals} accepts for the boot-time reduction, run once per failed call
 *   here rather than once per boot.
 */
export function findFederatedToolRefusal({ toolId, snapshot, messages }: { toolId: string; snapshot: readonly FederationAdmissionSnapshotEntry[]; messages: FederationRefusalMessages }
): FederatedToolRefusalLookup | null {
  for (const entry of snapshot) {
    for (const refusal of entry.report.refused) {
      if (federatedToolId({ connectionId: entry.connectionId, remoteName: refusal.remoteName }) !== toolId) continue;
      return {
        connectionId: entry.connectionId,
        remoteName: safeRemoteName({ remoteName: refusal.remoteName, messages: messages }),
        reason: refusal.reason,
        explanation: explainFederatedToolRefusal({ reason: refusal.reason, messages: messages }),
      };
    }
  }
  return null;
}

/** One rendered bullet. The connection id is operator-authored and pattern-validated by
 *  `assertValidConnectionId` before any tool from it is ever admitted, so it needs no sanitizing of
 *  its own; the remote name already went through {@link safeRemoteName}.
 *
 * The prompt prefix, or `""` when this boot has nothing to report (R-A).
 *
 * Prepended to a run's prompt by `agent-daemon-server.ts` through the same
 * `assemblePromptWithPluginPrefix` seam the capability manifest and agent-plugin prefixes already
 * use — deliberately not a new delivery mechanism, and deliberately not a tool: see this file's
 * header for why a model that does not know it is missing something never calls the tool that
 * would tell it.
 *
 * @param snapshot - `AttachFederatedToolsResult.reports`, verbatim.
 * @returns Prompt text, bounded per R-D, with the true total announced when the list is clipped.
 * @complexity O(c · t), plus O(n) rendering bounded by {@link MAX_ITEMS_IN_PREFIX}.
 */
export function buildFederatedRefusalPrefix({ snapshot, messages }: { snapshot: readonly FederationAdmissionSnapshotEntry[]; messages: FederationRefusalMessages }): string {
  const items = summarizeFederatedRefusals({ snapshot: snapshot, messages: messages });
  if (items.length === 0) return "";

  const shown = items.slice(0, MAX_ITEMS_IN_PREFIX);
  const lines = [messages.prefixHeading, "", messages.prefixInstruction, "", ...shown.map(item => messages.refusalBullet(item))];

  if (items.length > shown.length) {
    lines.push(
      messages.omittedRefusals({ omitted: items.length - shown.length, total: items.length }),
    );
  }

  return lines.join("\n");
}
