import { computeBlobStorageKey } from "../../media/blob-key.js";
import type { RoutingContentRecord } from "../../routing/ports.js";
import type { RouteResolveContext, RouteUrl } from "../../routing/types.js";
import { createCompositePeerBlobSource, type CompositeBlobStoreRead } from "./composite-blob-source.js";
import { applyPublishScope, buildExportBundle, includeReferencedEntities, selectBundleEntities, type PublishContentAuthorize, type PublishContentExportEnvelope } from "./export-bundle.js";
import type { PeerCallDeps, NotSupportedByLiveEntry, PeerTransport } from "./peer-transport.js";
import { appendSkippedRowsToPeerPlan, keepChangingIncludedEntities, labelPeerPlanRows, tagTrashingRows } from "./report-labels.js";
import type { PublishContentDeps, PublishContentTypeRegistry } from "./type-registry.js";
import type { PublishScope } from "./ui/index.js";

/**
 * What the host binds into the outbound plan builder. All three are REQUIRED and never defaulted:
 * the engine owns none of them (the host's publishable-type registry, its bound peer transport and
 * its public-URL routing).
 */
export interface PlanPublishToPeerHost<P> {
  /** The host-bound publishable-type registry's catalog builder, read fresh on every plan. */
  readonly catalog: { readonly build: PublishContentTypeRegistry<P>["buildCatalog"] };
  /** The host-bound outbound peer transport's push (`createPeerTransport(...).pushBundleToPeer`). */
  readonly pushBundleToPeer: PeerTransport["pushBundleToPeer"];
  /** The host's public-address routing for one post-shaped entity, resolved against the peer's origin. */
  entryPublicPath(
    required: { post: RoutingContentRecord; ctx: Pick<RouteResolveContext, "workspaceId" | "originOverride"> },
    optional?: object,
  ): Pick<RouteUrl, "canonicalUrl"> | null;
}

export interface PlanPublishToPeerDeps<P> {
  workspaceId: string;
  authorize: PublishContentAuthorize;
  publishContentDeps: PublishContentDeps<P>;
  workspaceRepo: { findById(input: { id: string }, optional?: {}): Promise<{ name?: string } | null> };
  blobStore: CompositeBlobStoreRead;
  fileBlobIndex: Parameters<typeof createCompositePeerBlobSource>[0]["fileBlobIndex"];
}

interface PlanPublishToPeerInput {
  scope?: PublishScope | null;
  selectedEntityKeys?: readonly string[] | null;
  overwriteEntityKeys?: readonly string[] | null;
}

export type PublishToPeerPlan = Record<string, unknown> & {
  publicUrls: Record<string, string>; itemNames: Record<string, string[]>;
  bundleId: string; liveCanOverwrite: boolean; overwriteEntityKeys?: readonly string[]; notSupportedByLive: readonly NotSupportedByLiveEntry[];
};

/** What the plan sends: the scoped bundle (kept for its `skipped` list), the bundle after the row
 *  selection and the carried-along rows, and which in-scope rows each carried row is for. */
interface StagedSelection {
  readonly scoped: PublishContentExportEnvelope;
  readonly bundle: PublishContentExportEnvelope;
  readonly includedFor: ReadonlyMap<string, readonly string[]>;
}

/** Packs the full bundle, then narrows it: scope first, then the row selection, then the rows the
 *  remaining ones use. */
async function selectBundleToPush<P>(
  { deps, principalId, input, host }: { deps: PlanPublishToPeerDeps<P>; host: PlanPublishToPeerHost<P>; principalId: string; input: PlanPublishToPeerInput },
  _optional = {}
): Promise<StagedSelection> {
  const workspace = await deps.workspaceRepo.findById({ id: deps.workspaceId });
  const publishContentDeps = deps.publishContentDeps;
  const fullBundle = await buildExportBundle({
                                               deps: {
      workspaceId: deps.workspaceId,
      principalId,
      authorize: deps.authorize,
      catalog: host.catalog,
      publishContentDeps,
      sourceLabel: workspace?.name ?? deps.workspaceId,
    }
                                             });
  // `scope` narrows first (`plan-publish-sections-2026-09-25.md` §1 — "Publish pages" never even
  // uploads a media blob), THEN `selectedEntityKeys` narrows that result further, so an operator's
  // row selection inside a scoped dialog can only ever shrink what the scope already allowed.
  // `skipped` is narrowed by `scope` alone: a skipped unit was never selectable in the first place
  // (`export-bundle.ts`'s own `selectBundleEntities` doc), so a row selection has nothing to add.
  const scoped = input.scope == null ? fullBundle : applyPublishScope({ envelope: fullBundle, scope: input.scope });
  // A selection narrows what is STAGED, before the peer plans it — so a deselected entity is
  // never uploaded, never planned and never applied, rather than being filtered out by some
  // later step that could forget. See `export-bundle.ts`'s `selectBundleEntities`.
  const selected = input.selectedEntityKeys == null ? scoped : selectBundleEntities({ envelope: scoped, selectedKeys: new Set(input.selectedEntityKeys) });
  // Owner decision 2026-09-25 (plan G3): a SCOPED run carries along what its (still-selected)
  // rows use — a page's images and widgets, a widget's form, an entry's collection — drawn from
  // the full bundle, derived after the selection, so a deselected page brings nothing and a
  // narrowed re-plan re-derives the same rule. An unscoped run already holds every row as an
  // ordinary one. See `includeReferencedEntities`.
  const { envelope: bundle, includedFor } =
    input.scope == null
      ? { envelope: selected, includedFor: new Map<string, readonly string[]>() }
      : includeReferencedEntities({ envelope: selected, source: fullBundle, handlers: host.catalog.build(publishContentDeps).handlerByType });
  return { scoped, bundle, includedFor };
}

function pushSelectedBundle<P>(
  { deps, peer, bundle, overwriteEntityKeys, host }: { host: PlanPublishToPeerHost<P>; deps: PlanPublishToPeerDeps<P>; peer: PeerCallDeps; bundle: PublishContentExportEnvelope; overwriteEntityKeys: readonly string[] | null | undefined },
  _optional = {}
) {
  return host.pushBundleToPeer(
    {
      deps: {
        ...peer,
        // S18 (S-F3) — sources a blob from the media blob store FIRST, falling back to
        // `RouteDeps.fileBlobIndex` (a file-tree type's `pack()` fill) so a blob that was never
        // copied into the blob store can still be pushed. See `@jini-ai/cms/publish/content/composite-blob-source`'s header.
        blobSource: createCompositePeerBlobSource({ blobStore: deps.blobStore, fileBlobIndex: deps.fileBlobIndex }),
        computeStorageKey: ({ sha256 }: { sha256: string }, _options = {}) => computeBlobStorageKey({ workspaceId: deps.workspaceId, sha256 }),
      },
      required: { bundle, ...(overwriteEntityKeys == null ? {} : { overwriteEntityKeys }) }
    }
  );
}

function publicUrlsOf<P>(
  { deps, peer, bundle, host }: { host: PlanPublishToPeerHost<P>; deps: PlanPublishToPeerDeps<P>; peer: PeerCallDeps; bundle: PublishContentExportEnvelope },
  _optional = {}
): Record<string, string> {
  return Object.fromEntries(bundle.entities.flatMap(entity => {
    if (entity.entityType !== "post" && entity.entityType !== "page") return [];
    const url = host.entryPublicPath({ post: entity.state as unknown as RoutingContentRecord, ctx: { workspaceId: deps.workspaceId, originOverride: peer.credential.baseUrl } });
    return url ? [[`${entity.entityType}:${entity.id}`, url.canonicalUrl]] : [];
  }));
}

function itemNamesOf({ bundle }: { bundle: PublishContentExportEnvelope }, _optional = {}): Record<string, string[]> {
  return Object.fromEntries(bundle.entities.map(entity => [`${entity.entityType}:${entity.id}`,
    [entity.state.title, entity.state.slug, entity.displayLabel].filter((name): name is string => typeof name === "string" && name.length > 0)]));
}

/** The peer's plan, with each row named from the bundle we just sent it — a live site
 * deployed before `entityLabel` existed answers rows with no label, and this side can name
 * its own content regardless. See `features/publish-content/report-labels.ts`.
 *
 * Then: every whole unit THIS instance refused to pack (`scoped.skipped` — e.g. a theme
 * tree `file-tree-policy.ts` blocked) appended as its own non-selectable row. It never
 * reached the peer's bundle at all, so the peer's own plan has no way to report it — this is
 * the one place a caller holds both reports at once. Read off `scoped`, not the
 * (possibly selection-narrowed) `bundle`: a skipped unit was never selectable, so an
 * operator's row selection has nothing to say about whether it is still shown, but `scope`
 * itself still applies — a refused theme tree only belongs in a theme-files-scoped plan.
 *
 * Last, a carried-along row that live would write is tagged with the rows that use it, an
 * unchanged one is dropped, and a conflicting/blocked one stays as an ordinary row so the
 * operator sees it — `report-labels.ts`'s `keepChangingIncludedEntities`. An update whose local
 * item is trashed is tagged `trashes` so the dialog says it trashes on live (`tagTrashingRows`). */
function annotatedPeerPlan(
  { result, selection }: { result: Awaited<ReturnType<PeerTransport["pushBundleToPeer"]>>; selection: StagedSelection },
  _optional = {}
) {
  const { scoped, bundle, includedFor } = selection;
  return appendSkippedRowsToPeerPlan(
    {
      plan: keepChangingIncludedEntities(
        {
          plan: tagTrashingRows({ plan: labelPeerPlanRows({ plan: result.plan, entities: bundle.entities }), entities: bundle.entities }),
          includedFor
        }
      ),
      skipped: scoped.skipped
    }
  );
}

/** Owner decision 2026-10-05: the assistant must publish on its own. The HTTP dialog and chat
 * share this outbound plan builder, and the destination remains the sole import gateway.
 * Selection narrows the staged bundle, never an execute-time filter an older live could ignore. */
export function createPlanPublishToPeer<P>(host: PlanPublishToPeerHost<P>, _optional = {}) {
  return (required: { deps: PlanPublishToPeerDeps<P>; peer: PeerCallDeps; principalId: string }, input: PlanPublishToPeerInput = {}): Promise<PublishToPeerPlan> =>
    planPublishToPeer({ ...required, host }, input);
}

async function planPublishToPeer<P>(
  required: { deps: PlanPublishToPeerDeps<P>; peer: PeerCallDeps; principalId: string; host: PlanPublishToPeerHost<P> },
  input: PlanPublishToPeerInput = {},
): Promise<PublishToPeerPlan> {
  const { deps, peer, principalId, host } = required;
  const selection = await selectBundleToPush({ deps, principalId, input, host });
  const { bundle } = selection;
  const result = await pushSelectedBundle({ deps, peer, bundle, host, overwriteEntityKeys: input.overwriteEntityKeys });

  // S-F1: `pushBundleToPeer` probes the peer's own capabilities and trims the bundle to what it
  // accepts BEFORE staging anything, so `bundle.entities.length` (the selection this route built)
  // can be larger than what was actually sent. `entityCount` reports what was actually sent;
  // `notSupportedByLive` names what was not, and why — see `peer-transport.ts`'s (feature)
  // `PushBundleResult.notSupportedByLive` doc.
  const heldBackCount = result.notSupportedByLive.reduce((sum, entry) => sum + entry.count, 0);

  // The peer's gated plan is SPREAD at the top level, not nested under a `plan` key: this route
  // answers with the same `{domain, planId, planHash, details}` shape the LOCAL `/import/plan`
  // route does, so a client renders one plan shape regardless of direction (Task 11 binds
  // `details` as its `PublishContentReport`). The push-only fields sit alongside it.
  //
  // `bundleId` is load-bearing, not informational: the peer's `/import/execute` requires the
  // same bundle it planned, so a client MUST carry this value from here into `push/execute`.
  // Holding it server-side instead would mean remembering per-operator state between two
  // requests, which is exactly the kind of implicit session the gated ceremony avoids.
  return {
    publicUrls: publicUrlsOf({ deps, peer, bundle, host }),
    itemNames: itemNamesOf({ bundle }),
    peerId: peer.credential.id,
    peerLabel: peer.credential.label,
    bundleId: result.bundleId,
    entityCount: bundle.entities.length - heldBackCount,
    blobsUploaded: result.blobsUploaded,
    blobsUnavailable: result.blobsUnavailable,
    notSupportedByLive: result.notSupportedByLive,
    // publish-overwrite-live-plan §4/S7 — whether the peer just probed can honour a forced
    // overwrite at all. The admin dialog and the chat tool (S8/S9) read this before ever
    // offering an "Overwrite on live" tick.
    liveCanOverwrite: result.liveCanOverwrite,
    // Echoed back exactly as received — never defaulted to `[]` — so a client can carry the SAME
    // set from this plan into `push/execute` (`ui/contract.ts`'s `PublishContentPlanResult`)
    // without keeping its own parallel copy in sync. Omitted entirely when nothing was ticked,
    // the same "absent, not an empty real answer" contract `selectedEntityKeys` itself reads by
    // (the HTTP route's `readSelectedEntityKeys` doc).
    ...(input.overwriteEntityKeys == null ? {} : { overwriteEntityKeys: input.overwriteEntityKeys }),
    ...annotatedPeerPlan({ result, selection }),
  };
}
