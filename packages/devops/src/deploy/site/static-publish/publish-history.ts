import type { StaticDeploymentDestination, DeploymentDestination } from "@jini-ai/core/contracts/site/deployment-admin";
import type { UUID } from "@jini-ai/core/primitives";

import type { StaticPublishTargetId } from "@jini-ai/devops/deploy/site/static-publish/types";
import type { DeployTargetDescriptor, DeployTargetRegistry } from "@jini-ai/devops/deploy/site/deploy-targets/types";

/**
 * @file Durable, append-only publish-history ledger.
 * Publish results are records, not cache slots: keeping them in the database makes them durable,
 * queryable and joinable without overwriting earlier publishes. publish-run.ts's in-process
 * snapshot answers whether a publish is running; it cannot supply persistent per-target history.
 *
 * Purpose:
 * {@link PublishHistoryStore} is the port — `getLast` (the single most recent row for a
 * `(workspace, target)` pair, what `deployment_get_static_publish_capabilities` surfaces as
 * `lastPublish`) and `list` (newest-first, workspace-scoped, optionally target-scoped — what a future
 * history UI would page through). {@link InMemoryPublishHistoryStore} is the test double, append-only
 * like the real table (a test asserting "the second publish did not erase the first" needs an
 * in-memory double that can actually fail that assertion). `SqlitePublishHistoryStore`
 * (`src/platform/db/sqlite/publish-history-repo.sqlite.ts`, this feature's real ADR-006 rule-of-two second
 * adapter) is the production implementation — it lives under `src/platform/db/sqlite/`, not here, matching
 * every other DB-backed port/adapter split in this codebase (`VendorCredentialSetRepoPort` in
 * `features/vendor-credentials/`, `SqliteVendorCredentialSetRepo` there in `db/sqlite/`).
 *
 * Architectural role:
 * `features/deployments/static-publish` domain logic — this file declares the port and its in-memory
 * test double only; no Drizzle/SQL import belongs here (that is the adapter's job, one layer down).
 * Static publishes settle through `publish-run.ts` (both its shared entry
 * points — the admin route's fire-and-forget `startPublishRun` and the agent tool's awaited
 * `runPublishAndAwait` — settle through the same function, so both callers record identically with no
 * change needed at either call site). `publish-agent-tools.ts`'s capabilities handler is the one
 * place `getLast` is read from today, surfaced per provider as `lastPublish`.
 * Coordinator decision (2026-10-18): outbound peer execution and deploy-ops also append here;
 * destination memory belongs to this ledger rather than separate per-flow stores.
 */

/** Which of this feature's two entry points produced a given {@link PublishHistoryEntry} — the admin
 *  UI's Static Site tab (`publish-site.ts`'s HTTP trigger route, via `startPublishRun`) or the
 *  assistant's confirmed publish tool (`publish-agent-tools.ts`'s `deployment_execute_static_publish`,
 *  via `runPublishAndAwait`). Free to compute at the source: `publish-run.ts`'s two entry functions
 *  each hardcode their own literal when calling into history recording, since which caller reached
 *  which function IS the answer — no request-scoped or caller-supplied value is needed. */
export type PublishTrigger = "admin_ui" | "agent_tool";

/** One recorded publish — a row in the append-only ledger, not a cache slot. `owner`/`repo`/`branch`/
 *  `commitSha` are present only for a git-backed target (`StaticPublishConfig`'s own per-target
 *  field split — see `types.ts`); every other target carries none of the four. `commitSha` specifically is
 *  NOT a placeholder that is always empty for every other target because it could not be obtained —
 *  it genuinely does not exist for them (their publishes are not git commits); see
 *  `publish-run.ts`'s `toHistoryEntry` for where this is derived from the target's own outcome. */
export interface PublishHistoryEntry {
  /** Absent/null legacy discriminator means static. Other kinds reuse target as their owner id. */
  readonly kind?: "static" | "tovu-peer" | "deploy";
  readonly target: StaticPublishTargetId;
  readonly url: string;
  /** `false` for an accepted deploy without confirmed landing, or an "uploaded, not yet confirmed
   *  reachable" partial outcome (`StaticPublishOutcome`'s own `ok: "partial"` branch). Everything else that reaches this store
   *  at all is a full, confirmed-live success (see {@link PublishHistoryStore.recordSuccess}'s own
   *  doc: an `ok: false` outcome is never recorded, so `reachable` is never "the publish failed"). */
  readonly reachable: boolean;
  readonly status: string;
  readonly projectName: string;
  /** Saved connection actually resolved, including default selection; never its secret. */
  readonly credentialId?: string;
  /** Descriptor-allowlisted non-secret settings. Absent on legacy, non-replayable history. */
  readonly configFields?: Readonly<Record<string, string>>;
  readonly publishedAt: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly basePath?: string;
  /** The provider's own opaque identifier for this publish — `StaticPublishOutcome.deploymentId`,
   *  verbatim, whatever it means for that target (a host deploy id, or, for a git-backed target, the
   *  same commit sha `commitSha` below also carries). Absent when the outcome carried none (a
   *  target with no deployment concept, e.g. an object-store upload). */
  readonly deploymentId?: string;
  /** Git-backed targets only — see this interface's own header. */
  readonly commitSha?: string;
  /** Git-backed targets only — the branch actually published to. */
  readonly branch?: string;
  readonly triggeredBy: PublishTrigger;
}

/** Workspace-and-target-scoped read/write for the publish-history ledger. */
export interface PublishHistoryStore {
  /** Latest success or explicitly pending deploy per (kind, target, projectName), across the full workspace
   * ledger. At most 201 rows; the read service refuses over 200 rather than hiding destinations. */
  listDestinationHistory(input: { workspaceId: UUID }, options?: Record<string, never>): Promise<PublishHistoryEntry[]>;
  /** The single most recent recorded publish for `(workspaceId, target)`, or `null` if none has ever
   *  been recorded — what `deployment_get_static_publish_capabilities` surfaces as `lastPublish`. */
  getLast(input: { workspaceId: UUID; target: StaticPublishTargetId }): Promise<PublishHistoryEntry | null>;
  /** Every recorded publish for `workspaceId`, newest first, optionally narrowed to one `target` —
   *  what a future read-only history view would page through. `limit` defaults to
   *  `DEFAULT_PUBLISH_HISTORY_LIST_LIMIT` and is clamped to `MAX_PUBLISH_HISTORY_LIST_LIMIT`
   *  (`core/publish-history-list-limit.ts`) regardless of what a caller requests: this table is
   *  append-only and grows for the life of an install (`REVIEWED_INTEGER_ID_COLUMNS` in
   *  `db/migration/manifest.ts` reviews `publish_history.id` as `"unbounded"` for exactly this
   *  reason), so an unbounded `list` call is a real resource-exhaustion risk a workspace with years of
   *  publish history could actually trigger, not a hypothetical one. */
  list(input: { workspaceId: UUID; target?: StaticPublishTargetId; limit?: number }): Promise<PublishHistoryEntry[]>;
  /** Distinct workspace-scoped saved live URLs across the full ledger (t08). At most 201:
   * callers refuse an over-200-address set instead of silently losing older destinations. */
  listLiveUrls(input: { workspaceId: UUID }): Promise<string[]>;
  /** Appends a new row — an append-only ledger, never a replace-in-place. Named for what it is ever
   *  called with, not what it is capable of rejecting: an `ok: false` `StaticPublishOutcome` is never
   *  passed to it at all (the caller, `publish-run.ts`'s `toHistoryEntry`, decides that, not this
   *  port), so `recordSuccess` never means "the publish failed." */
  recordSuccess(input: { workspaceId: UUID; entry: PublishHistoryEntry }): Promise<void>;
}

/** Test double — append-only like the real table (a `Map<key, PublishHistoryEntry[]>`, not
 *  `Map<key, PublishHistoryEntry>`), so a test can actually assert "the second publish did not erase
 *  the first." Dies on process restart, same as any in-memory double; production always uses
 *  `SqlitePublishHistoryStore` instead (`host src/server/runtime/composition/deps.ts`), never this class. */
export class InMemoryPublishHistoryStore implements PublishHistoryStore {
  constructor(private readonly required: { resolvePublishHistoryListLimit(input: { requested: number | undefined }): number }, _optional = {}) {}
  private readonly entriesByWorkspace = new Map<UUID, PublishHistoryEntry[]>();

  /** Full-ledger selection, matching SQL's kind-scoped grouped max(id). O(n) time, O(d) space for n runs/d destinations. */
  async listDestinationHistory(input: { workspaceId: UUID }, _options: Record<string, never> = {}): Promise<PublishHistoryEntry[]> {
    const latest = new Map<string, PublishHistoryEntry>();
    const rows = this.entriesByWorkspace.get(input.workspaceId) ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined) throw new Error("Publish history has no row at its recorded position");
      const key = JSON.stringify([row.kind ?? "static", row.target, row.projectName]);
      if (isReplayableDestination({ row }) && !latest.has(key)) latest.set(key, row);
      if (latest.size > 200) break;
    }
    return [...latest.values()];
  }

  async getLast(input: { workspaceId: UUID; target: StaticPublishTargetId }): Promise<PublishHistoryEntry | null> {
    const rows = this.entriesByWorkspace.get(input.workspaceId) ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined) throw new Error("Publish history has no row at its recorded position");
      if ((row.kind ?? "static") === "static" && row.target === input.target) return row;
    }
    return null;
  }

  async list(input: { workspaceId: UUID; target?: StaticPublishTargetId; limit?: number }): Promise<PublishHistoryEntry[]> {
    const limit = this.required.resolvePublishHistoryListLimit({ requested: input.limit });
    const rows = this.entriesByWorkspace.get(input.workspaceId) ?? [];
    const matching = input.target === undefined ? rows : rows.filter((row) => row.target === input.target);
    // Newest-first: entries are appended oldest-to-newest, so reverse before slicing to `limit`.
    return matching.slice().reverse().slice(0, limit);
  }

  async listLiveUrls(input: { workspaceId: UUID }): Promise<string[]> {
    const urls = new Set<string>();
    for (const entry of this.entriesByWorkspace.get(input.workspaceId) ?? []) {
      urls.add(entry.url);
      if (urls.size > 200) break;
    }
    return [...urls].sort();
  }

  async recordSuccess(input: { workspaceId: UUID; entry: PublishHistoryEntry }): Promise<void> {
    const rows = this.entriesByWorkspace.get(input.workspaceId) ?? [];
    rows.push(input.entry);
    this.entriesByWorkspace.set(input.workspaceId, rows);
  }
}

/** Public replay contract; credentialId identifies a connection and never carries its secret. */
export type StaticPublishDestination = StaticDeploymentDestination;

/** Only declared public config may enter history or a response. Credential fields are excluded even
 * if a descriptor accidentally also declares them as config. O(f*c) for f config/c credential fields.
 * @example publicPublishConfigFields({ descriptor, config: input.config }) */
export function publicPublishConfigFields(input: {
  descriptor: DeployTargetDescriptor;
  config: Readonly<Record<string, unknown>>;
}, _options: Record<string, never> = {}): Record<string, string> {
  const credential = input.descriptor.credential;
  return Object.fromEntries(input.descriptor.configFields
    .filter(field => {
      if (field.secret || ["target", "credentialId", "projectName"].includes(field.name)) return false;
      if (field.name === credential?.tokenField || credential?.fields.some(candidate => candidate.name === field.name)) return false;
      return typeof input.config[field.name] === "string";
    })
    .map(field => [field.name, input.config[field.name] as string]));
}

/** Read saved destinations without resolving credentials. Store failures propagate to the HTTP
 * boundary. Newest publish time first, independently of ledger insertion order.
 * One bounded ledger read, O(d*f*c + d log d) time, O(d*f) response space; d <= 200.
 * @example listStaticPublishDestinations({ workspaceId, historyStore, registry }) */
export async function listStaticPublishDestinations(input: {
  workspaceId: UUID;
  historyStore: PublishHistoryStore;
  registry: DeployTargetRegistry;
}, _options: Record<string, never> = {}): Promise<StaticPublishDestination[]> {
  const rows = await input.historyStore.listDestinationHistory({ workspaceId: input.workspaceId });
  if (rows.length > 200) throw new Error("publish destination limit exceeded (200)");
  return staticDestinations({ rows, registry: input.registry });
}

/** Descriptor-owned public static projection, shared by the static compatibility API and mixed list. */
function staticDestinations(input: { rows: readonly PublishHistoryEntry[]; registry: DeployTargetRegistry }): StaticPublishDestination[] {
  return input.rows.flatMap(row => {
    const target = input.registry.get(row.target);
    if ((row.kind ?? "static") !== "static" || !row.reachable) return [];
    if (row.configFields === undefined || target === undefined) return [];
    return [{
      id: `static:${encodeURIComponent(row.target)}:${encodeURIComponent(row.projectName)}`,
      kind: "static" as const,
      lastPublishedAt: row.publishedAt,
      label: `${target.descriptor.label}: ${row.projectName}`,
      url: row.url,
      target: row.target,
      projectName: row.projectName,
      ...(row.credentialId !== undefined ? { credentialId: row.credentialId } : {}),
      configFields: publicPublishConfigFields({ descriptor: target.descriptor, config: row.configFields }),
    }];
  }).sort((a, b) => Date.parse(b.lastPublishedAt) - Date.parse(a.lastPublishedAt));
}

export type PublishDestination = DeploymentDestination<{
  readonly id: string;
  readonly kind: "tovu-peer";
  readonly peerId: string;
  readonly label: string;
  readonly url: string;
  readonly lastPublishedAt: string;
}>;

/** One bounded ledger read, no credential resolution. Only caller-authorized saved peer summaries
 * may enter this projection; deleted peers never become destinations from stale history.
 * @returns Latest successful destinations and explicitly pending deploys, newest first; throws on the 200-destination cap.
 * @complexity O(d*p + d*f*c + d log d), d <= 200, p saved peers; no per-row I/O.
 * @example listPublishDestinations({ workspaceId, historyStore, registry, peers })
 */
export async function listPublishDestinations(input: {
  workspaceId: UUID;
  historyStore: PublishHistoryStore;
  registry: DeployTargetRegistry;
  peers: readonly { id: string; label: string; baseUrl: string }[];
}, _options: Record<string, never> = {}): Promise<PublishDestination[]> {
  const rows = await input.historyStore.listDestinationHistory({ workspaceId: input.workspaceId });
  if (rows.length > 200) throw new Error("publish destination limit exceeded (200)");
  const destinations: PublishDestination[] = staticDestinations({ rows, registry: input.registry });
  const peers = new Map(input.peers.map(peer => [peer.id, peer]));
  destinations.push(...rows.flatMap((row): PublishDestination[] => {
    if (!isConfirmedOrPending({ row })) return [];
    if (row.kind === "tovu-peer") {
      const peer = peers.get(row.target);
      return peer ? [{ id: `tovu-peer:${peer.id}`, kind: "tovu-peer", peerId: peer.id,
        label: peer.label, url: peer.baseUrl, lastPublishedAt: row.publishedAt }] : [];
    }
    if (row.kind === "deploy" && row.url !== "") {
      return [deployDestination({ row, peers: input.peers })];
    }
    return [];
  }));
  return destinations.sort((a, b) => Date.parse(b.lastPublishedAt) - Date.parse(a.lastPublishedAt));
}

/** Replay needs public static config or a peer/deploy identity, in addition to an eligible outcome. */
function isReplayableDestination({ row }: { row: PublishHistoryEntry }, _options: Record<string, never> = {}): boolean {
  return isConfirmedOrPending({ row }) && (row.kind === "tovu-peer" || row.kind === "deploy" || row.configFields !== undefined);
}

/** Ledger eligibility is shared by selection and projection: only deploys can be pending. */
function isConfirmedOrPending({ row }: { row: PublishHistoryEntry }, _options: Record<string, never> = {}): boolean {
  return row.reachable || (row.kind === "deploy" && row.status === "started");
}

/** A deploy's public status and optional link to a saved peer, without credential resolution. */
function deployDestination({ row, peers }: {
  row: PublishHistoryEntry;
  peers: readonly { id: string; label: string; baseUrl: string }[];
}, _options: Record<string, never> = {}): Extract<PublishDestination, { kind: "deploy" }> {
  const pendingDeploy = row.status === "started";
  // Normalized addresses match root URLs with or without a trailing slash, never by hostname alone.
  const peer = peers.find(candidate => candidate.baseUrl.replace(/(?<!\/)\/+$/, "") === row.url.replace(/(?<!\/)\/+$/, ""));
  return { id: `deploy:${encodeURIComponent(row.target)}:${encodeURIComponent(row.projectName)}`,
    kind: "deploy", target: row.target, label: row.projectName, url: row.url,
    // Acceptance alone never claims a live site, including rows written before this guard.
    status: pendingDeploy ? "started" : "confirmed",
    ...(pendingDeploy ? { statusMessage: "Deploy started, not confirmed" } : {}),
    lastPublishedAt: row.publishedAt, ...(peer ? { linkedPeerId: peer.id } : {}) };
}
