import { ToolInputError } from "@jini-ai/core";
import type { Clock } from "@jini-ai/core/primitives";
import { selectConnectedDestination, type PublishContentPeerRepoPort } from "./peer-registry.js";
import { canPublishToLive, PUBLISH_FROM_LIVE_SITE_ERROR, type CanPublishToLiveOptions } from "./live-site-policy.js";
import type { NotSupportedByLiveEntry, PeerCallDeps, PeerHttpClient, PeerTransport, PeerTransportCredential, PublishHistoryRecorder } from "./peer-transport.js";
import type { createPlanPublishToPeer, PlanPublishToPeerDeps, PublishToPeerPlan } from "./push-plan.js";
import type { PublishContentDeps } from "./type-registry.js";
import {
  canConfirmPlan,
  overwriteReplanIsConsistent,
  selectableRowKeys,
  type CriteriaSelection,
  type PublishContentPlanResult,
  type PublishContentReport,
  type PublishCriteria,
  type PublishReportRow,
} from "./ui/index.js";

/**
 * The deps bag the tool reads, structurally: the workspace, the peer repo and HTTP client, and the
 * pieces of the shared plan/projection deps. The host's own bag may carry much more; it is handed
 * through untouched to {@link PublishToolHost.resolveCredential} and the plan builder.
 */
export interface PublishToolDeps<P> extends Omit<PlanPublishToPeerDeps<P>, "publishContentDeps"> {
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  readonly publishContentPeerRepo: PublishContentPeerRepoPort;
  readonly publishContentPeerHttpClient: PeerHttpClient;
  readonly publishHistoryStore?: PublishHistoryRecorder;
  /** Composition injects the SAME projection the HTTP importer uses, without a feature->server import. */
  readonly makePublishContentDeps?: () => PublishContentDeps<P>;
  /** One-bag-per-type ports for callers supplying an explicit projection. */
  readonly publishContentPorts?: Partial<P>;
}

/** The host's publish-dialog semantics (policy-bound), as the tool reads them. */
export interface PublishToolUi {
  toPublishReportRows(required: { report: PublishContentReport }, optional?: { completed?: boolean }): readonly PublishReportRow[];
  applyPublishCriteria(required: { rows: readonly PublishReportRow[]; criteria: PublishCriteria & { readonly excludeItems?: readonly string[] } }, optional?: Record<string, never>): CriteriaSelection;
  parsePublishContentToolInput(required: { input: Record<string, unknown> }, optional?: Record<string, never>): PublishCriteria;
  preparePublishConfirmation(
    required: { plan: PublishContentPlanResult; deselectedKeys: ReadonlySet<string>;
      planPublish: (input: { selectedEntityKeys: readonly string[]; overwriteEntityKeys?: readonly string[] }) => Promise<PublishContentPlanResult> },
    optional?: Record<string, never>,
  ): Promise<PublishContentPlanResult>;
}

/**
 * The host values the publish tool needs and the package must not import. Every field is REQUIRED.
 * `D` is the host's deps bag and `P` its publish port bag, handed through untouched.
 */
export interface PublishToolHost<D extends PublishToolDeps<P>, P> {
  /** The host's runtime-mode resolver; only its `production` answer marks the live site. */
  readonly resolveRuntimeMode: CanPublishToLiveOptions["resolveRuntimeMode"];
  /** Opens the destination's credential (sealed key or connected handshake) for one outbound request. */
  resolveCredential(required: { deps: D; input: { workspaceId: string; id: string } }, optional?: Record<string, never>): Promise<PeerTransportCredential>;
  /** The host-bound outbound plan builder (`createPlanPublishToPeer`). */
  readonly planPublishToPeer: ReturnType<typeof createPlanPublishToPeer<P>>;
  /** The host-bound peer transport's confirm and execute legs. */
  readonly peerTransport: Pick<PeerTransport, "confirmPeerImport" | "executePeerImport">;
  readonly ui: PublishToolUi;
  /** The capability id prefixing the criteria parser's errors; the tool re-prefixes them with its own id. */
  readonly criteriaCapabilityId: string;
}

type Criteria = PublishCriteria & { readonly excludeItems?: readonly string[] };

/** Strict tool boundary: misspelled filters must never widen an autonomous publish. */
function readCriteria({ input, host }: { input: Record<string, unknown>; host: Pick<PublishToolHost<never, never>, "ui" | "criteriaCapabilityId"> }): Criteria {
  for (const key of ["types", "items", "excludeItems"] as const) {
    const value = input[key];
    if (value !== undefined && (!Array.isArray(value) || value.length > 1000 ||
      !value.every(item => typeof item === "string" && item.trim().length > 0))) {
      throw new ToolInputError({ message: `'${key}' must be an array of at most 1000 non-empty strings.` });
    }
  }
  try {
    return { ...host.ui.parsePublishContentToolInput({ input }), ...(input.excludeItems === undefined ? {} : { excludeItems: input.excludeItems as string[] }) };
  } catch (error) {
    const prefix = `${host.criteriaCapabilityId}:`;
    throw new ToolInputError({ message: error instanceof Error ? (error.message.startsWith(prefix) ? "publish_content_publish:" + error.message.slice(prefix.length) : error.message) : "Invalid publish selection." });
  }
}

/** The remote report is untrusted; refuse malformed/refused plans before any confirm call. */
function readReport({ value }: { value: unknown }, _optional = {}): PublishContentReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolInputError({ message: "The live site returned no publish report." });
  const report = value as PublishContentReport;
  const outcomes = new Set(["created", "applied", "forced", "unchanged", "conflict", "blocked"]);
  if (typeof report.refused !== "boolean" || !Array.isArray(report.rows) || !report.rows.every(row => validReportRow({ row, outcomes }))) {
    throw new ToolInputError({ message: "The live site returned an invalid publish report." });
  }
  if (report.refused) throw new ToolInputError({ message: report.refusalReason ?? "The live site refused this publish." });
  return report;
}

/** A remote row's write flag must agree with its outcome before it can be reported as published.
 * @complexity O(1) time and space per row. */
function validReportRow(
  { row, outcomes }: { row: PublishContentReport["rows"][number]; outcomes: ReadonlySet<string> },
  _options: Record<string, never> = {},
): boolean {
  if (!row || typeof row.entityType !== "string" || typeof row.entityId !== "string") return false;
  return typeof row.writes === "boolean" && outcomes.has(row.outcome) &&
    row.writes === ["created", "applied", "forced"].includes(row.outcome);
}

type PlanSelection = { selectedEntityKeys?: readonly string[]; overwriteEntityKeys?: readonly string[] };
type ToolPlan = PublishToPeerPlan & { planId: string; planHash: string; details: PublishContentReport };
type ToolPlanner = (selection?: PlanSelection) => Promise<ToolPlan>;
type ToolReportRow = PublishReportRow;
type SkippedItem = { entityKey: string; title: string | null; reason: string };
/** What the final result builders share: the first plan, the plan that was confirmed, and what was skipped. */
type PublishSummary = { initial: ToolPlan; confirmed: PublishContentPlanResult & { notSupportedByLive?: unknown }; selection: CriteriaSelection; skipped: SkippedItem[]; urls: Record<string, string> };
type ToolPeer = PeerCallDeps;
type ToolContentDeps<P> = PublishContentDeps<P>;

/**
 * Builds the CMS-specific autonomous push, bound to a host's credential resolution, plan builder,
 * peer transport and publish-dialog policy. Ports supply credential resolution, export and peer HTTP; no
 * model mocks or second importer. The dialog shares push-plan and preparePublishConfirmation.
 * Only explicit overwrite:true selects conflict keys, then the exact same keys travel to execute.
 * Results describe actual apply outcomes: race-time conflicts must never be called published.
 * @returns `publishContentFromTool`, which throws ToolInputError for refused selections or reports.
 * @complexity O(1) wiring; the tool is O(rows) per plan plus one network round trip per leg.
 */
export function createPublishContentFromTool<D extends PublishToolDeps<P>, P>({ host }: { host: PublishToolHost<D, P> }, _optional = {}) {
  return async function publishContentFromTool(
    required: { deps: D; principalId: string },
    input: Record<string, unknown> = {},
  ) {
    const criteria = readCriteria({ input, host });
    if (!canPublishToLive({ resolveRuntimeMode: host.resolveRuntimeMode })) throw new ToolInputError({ message: PUBLISH_FROM_LIVE_SITE_ERROR });
    const { deps, principalId } = required;
    const credential = await destinationCredential({ deps, input, host });
    const { peer, contentDeps } = planningDeps({ deps, credential });
    const plan: ToolPlanner = (selection: PlanSelection = {}) => planForTool({ context: { deps, peer, contentDeps, principalId }, selection, host });
    const initial = await plan();
    const selectionRows = host.ui.toPublishReportRows({ report: initial.details }).map(row => ({ ...row, names: initial.itemNames[row.key] ?? [] }));
    const selection = host.ui.applyPublishCriteria({ rows: selectionRows.map(row => ({ ...row, selectable: true })), criteria });
    const skipped = excludedBySelection({ selectionRows, selection });
    const chosen = await choosePlan({ initial, selection, plan });
    // Nothing selected: never re-stage an empty bundle on live, and never confirm `chosen`, which
    // still holds every row.
    const nothingSelected = selectableRowKeys({ rows: host.ui.toPublishReportRows({ report: chosen.details }) }).every(key => selection.deselectedKeys.has(key));
    const confirmed = await confirmationPlan({ chosen, nothingSelected, selection, plan, host });
    const urls = (confirmed as ToolPlan).publicUrls ?? chosen.publicUrls;
    const summary = { initial, confirmed, selection, skipped, urls };
    let execution: Record<string, unknown> | null = null;
    let actual = confirmed.details;
    if (!nothingSelected && canConfirmPlan({ kind: "planned", plan: confirmed })) {
      execution = await confirmAndExecute({ peer, confirmed, host });
      // Old live builds omit per-item outcomes. A successful HTTP response alone cannot prove every
      // planned row landed: apply can downgrade a concurrent edit to a conflict after token checking.
      // Keep the completed run and explicitly report uncertainty instead of fabricating success.
      if (execution.report === undefined) return legacyResult({ summary, selectionRows, execution });
      actual = readReport({ value: execution.report });
    }
    return completedResult({ summary, actual, execution, baseUrl: credential.baseUrl, host });
  };
}

/** Source items the peer's build cannot hold never reached it, so it cannot report them: they come back as blocked rows. */
function heldBackRows({ raw }: { raw: PublishToPeerPlan }) {
  const unsupported = new Set(raw.notSupportedByLive.map((item: NotSupportedByLiveEntry) => item.entityType));
  return Object.entries(raw.itemNames).flatMap(([key, names]) => {
    const separator = key.indexOf(":");
    const entityType = key.slice(0, separator);
    if (!unsupported.has(entityType)) return [];
    return [{
      entityType, entityId: key.slice(separator + 1), entityLabel: names[0] ?? null,
      outcome: "blocked" as const, writes: false, canOverwrite: false,
      reason: "The live site's build does not support this kind of content yet."
    }];
  });
}

async function planForTool<D extends PublishToolDeps<P>, P>(
  { context, selection, host }: { context: { deps: D; peer: ToolPeer; contentDeps: ToolContentDeps<P>; principalId: string }; selection: PlanSelection; host: Pick<PublishToolHost<D, P>, "planPublishToPeer"> },
  _optional: Record<string, never> = {},
): Promise<ToolPlan> {
  const { deps, peer, contentDeps, principalId } = context;
  const raw = await host.planPublishToPeer({ deps: { ...deps, publishContentDeps: contentDeps }, peer, principalId }, selection);
  if (typeof raw.planId !== "string" || typeof raw.planHash !== "string") throw new ToolInputError({ message: "The live site returned an invalid publish plan." });
  const details = readReport({ value: raw.details });
  // Unsupported source items never reached the peer, so it cannot report them. Preserve each
  // title in the tool's skipped results, just as the dialog preserves its type-level notice.
  const heldBack = heldBackRows({ raw });
  return { ...raw, planId: raw.planId, planHash: raw.planHash, details: { ...details, rows: [...details.rows, ...heldBack] } };
}

/** Every unmatched row is deselected (so it is filtered out of the result lists), but only
 * one that would otherwise have been written is worth naming as excluded. */
function excludedBySelection({ selectionRows, selection }: { selectionRows: readonly ToolReportRow[]; selection: CriteriaSelection }): SkippedItem[] {
  return selectionRows.filter(row => selection.deselectedKeys.has(row.key) && row.disposition === "publish").map(row => ({
    entityKey: row.key, title: row.entityLabel, reason: "Excluded by the requested selection."
  }));
}

async function choosePlan({ initial, selection, plan }: { initial: ToolPlan; selection: CriteriaSelection; plan: ToolPlanner }, _optional: Record<string, never> = {}) {
  let chosen = initial;
  if (selection.overwriteKeys.size > 0) {
    if (!initial.liveCanOverwrite) throw new ToolInputError({ message: "The live site cannot overwrite content yet. Update it before trying again." });
    chosen = await plan({ overwriteEntityKeys: [...selection.overwriteKeys] });
    if (!overwriteReplanIsConsistent({ shown: initial.details, next: chosen.details, tickedKeys: selection.overwriteKeys, changing: selection.overwriteKeys })) {
      throw new ToolInputError({ message: "The live site changed while publishing was being planned. Check the list again." });
    }
  }
  return chosen;
}

async function confirmationPlan({ chosen, nothingSelected, selection, plan, host }: { chosen: ToolPlan; nothingSelected: boolean; selection: CriteriaSelection; plan: ToolPlanner; host: Pick<PublishToolHost<never, never>, "ui"> }, _optional: Record<string, never> = {}) {
  let confirmed: PublishContentPlanResult = chosen;
  try {
    if (!nothingSelected) confirmed = await host.ui.preparePublishConfirmation({ plan: chosen, deselectedKeys: selection.deselectedKeys, planPublish: plan });
  } catch (error) {
    throw new ToolInputError({ message: error instanceof Error ? error.message : "Could not plan this publish." });
  }
  return confirmed;
}

async function confirmAndExecute({ peer, confirmed, host }: { peer: ToolPeer; confirmed: PublishContentPlanResult; host: Pick<PublishToolHost<never, never>, "peerTransport"> }): Promise<Record<string, unknown>> {
  const { confirmationToken } = await host.peerTransport.confirmPeerImport({ deps: peer, required: { planId: confirmed.planId, planHash: confirmed.planHash } });
  return host.peerTransport.executePeerImport({
    deps: peer,
    required: {
      bundleId: confirmed.bundleId, confirmationToken,
      ...(confirmed.overwriteEntityKeys?.length ? { overwriteEntityKeys: confirmed.overwriteEntityKeys } : {})
    }
  });
}

function legacyResult({ summary, selectionRows, execution }: { summary: PublishSummary; selectionRows: readonly ToolReportRow[]; execution: Record<string, unknown> }, _optional: Record<string, never> = {}) {
  const { confirmed, selection, skipped, urls } = summary;
  skipped.push(...selectionRows.filter(row => row.disposition === "skipped" && !selection.deselectedKeys.has(row.key) && !selection.overwriteKeys.has(row.key)).map(row => ({ entityKey: row.key, title: row.entityLabel, reason: row.reason ?? "The live site skipped this item." })));
  return {
    published: [], skipped, unverified: confirmed.details.rows.filter(row => row.writes).map(row => ({
      entityKey: `${row.entityType}:${row.entityId}`, title: row.entityLabel, publicUrl: urls[`${row.entityType}:${row.entityId}`] ?? null
    })),
    runId: execution.runId, message: "The publish run completed, but this live site's version did not return per-item results. I could not verify which items landed. Update the live site to receive those results.",
    unmatchedItems: selection.unmatchedItems, unknownTypes: selection.unknownTypes, verificationProblems: execution.verificationProblems ?? []
  };
}

function completedResult({ summary, actual, execution, baseUrl, host }: { summary: PublishSummary; actual: PublishContentReport; execution: Record<string, unknown> | null; baseUrl: string; host: Pick<PublishToolHost<never, never>, "ui"> }, _optional: Record<string, never> = {}) {
  const { initial, confirmed, selection, skipped, urls } = summary;
  const rows = host.ui.toPublishReportRows({ report: actual });
  const published = execution ? rows.filter(row => row.appliesOnExecute).map(row => ({
    entityKey: row.key, title: row.entityLabel, outcome: row.outcome, publicUrl: urls[row.key] ?? null
  })) : [];
  // Locally skipped pack units and unsupported types never reached live's apply report.
  const known = new Set(rows.map(row => row.key));
  const omitted = host.ui.toPublishReportRows({ report: initial.details }).filter(row => !row.appliesOnExecute && !known.has(row.key) && !selection.deselectedKeys.has(row.key));
  skipped.push(...[...rows, ...omitted].filter(row => row.disposition === "skipped" && !selection.deselectedKeys.has(row.key)).map(row => ({ entityKey: row.key, title: row.entityLabel, reason: row.reason ?? "The live site skipped this item." })));
  const publishedItemLabel = published.length === 1 ? "item" : "items";
  return {
    published, skipped, unchanged: [...rows, ...omitted].filter(row => row.disposition === "unchanged" && !selection.deselectedKeys.has(row.key)).map(row => ({ entityKey: row.key, title: row.entityLabel })),
    unmatchedItems: selection.unmatchedItems, unknownTypes: selection.unknownTypes, notSupportedByLive: confirmed.notSupportedByLive ?? [],
    runId: execution?.runId ?? null, verificationProblems: execution?.verificationProblems ?? [],
    message: published.length ? `Published ${published.length} ${publishedItemLabel} to ${baseUrl}. Skipped ${skipped.length}.` : `Published nothing. Skipped ${skipped.length}.`
  };
}

async function destinationCredential<D extends PublishToolDeps<P>, P>({ deps, input, host }: { deps: D; input: Record<string, unknown>; host: Pick<PublishToolHost<D, P>, "resolveCredential"> }, _optional: Record<string, never> = {}) {
  const peers = await deps.publishContentPeerRepo.listByWorkspace({ workspaceId: deps.workspaceId });
  if (input.peerId !== undefined && (typeof input.peerId !== "string" || !input.peerId.trim())) {
    throw new ToolInputError({ message: "'peerId' must be a non-empty string." });
  }
  const peerId = typeof input.peerId === "string" ? input.peerId : defaultPeerId({ peers });
  if (!peerId) throw new ToolInputError({ message: peers.length ? "Several destinations are saved. Choose a peerId before publishing." : "No live destination is connected. Connect this computer with publish_content_connect, then publish again." });
  return host.resolveCredential({ deps, input: { workspaceId: deps.workspaceId, id: peerId } });
}

function defaultPeerId({ peers }: { peers: Awaited<ReturnType<PublishContentPeerRepoPort["listByWorkspace"]>> }, _optional: Record<string, never> = {}) {
  return (selectConnectedDestination({ rows: peers }) ?? (peers.length === 1 ? peers[0] : null))?.id;
}

function planningDeps<D extends PublishToolDeps<P>, P>({ deps, credential }: { deps: D; credential: PeerTransportCredential }, _optional: Record<string, never> = {}) {
  const peer: ToolPeer = {
    credential, httpClient: deps.publishContentPeerHttpClient,
    ...(deps.publishHistoryStore ? { publishHistory: { store: deps.publishHistoryStore, workspaceId: deps.workspaceId, clock: deps.clock, triggeredBy: "agent_tool" as const } } : {})
  };
  const contentDeps: ToolContentDeps<P> = deps.makePublishContentDeps?.() ?? {
    workspaceId: deps.workspaceId, clock: deps.clock,
    idGen: deps.idGen, ports: deps.publishContentPorts ?? {}
  };
  return { peer, contentDeps };
}
