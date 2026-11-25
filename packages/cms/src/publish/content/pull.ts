import { computeBlobStorageKey } from "../../media/blob-key.js";
import { stageBundle, type StageBundleDeps } from "../transfer/bundle-staging.js";
import type { PeerHttpClient, PeerTransport, PeerTransportCredential } from "./peer-transport.js";

/** Ports shared by the HTTP pull route and assistant tools. Credentials come only from saved peers. */
export interface PublishContentPullDeps {
  workspaceId: string;
  clock: StageBundleDeps["clock"];
  idGen: StageBundleDeps["idGen"];
  publishContentBundleRepo: StageBundleDeps["repo"];
  publishContentPeerHttpClient: PeerHttpClient;
  blobStore: Parameters<PeerTransport["pullBlobsFromPeer"]>[0]["deps"]["blobSink"];
}

/**
 * The host values a pull needs and the package must not import: how a saved peer's credential is
 * opened (the host's handshake, sealed-key opener and refusal wording) and the host-bound outbound
 * transport (see `createPeerTransport`). Every field is REQUIRED. `D` is the host's deps bag, handed
 * through untouched so the host can read its own peer repo, sealer and keyring from it.
 */
export interface PublishContentPullHost<D extends PublishContentPullDeps> {
  /** Resolves whatever credential the saved peer `input.id` is due, for one outbound request. */
  resolveCredential(required: { deps: D; input: { workspaceId: string; id: string } }, optional?: Record<string, never>): Promise<PeerTransportCredential>;
  readonly pullBundleFromPeer: PeerTransport["pullBundleFromPeer"];
  readonly pullBlobsFromPeer: PeerTransport["pullBlobsFromPeer"];
}

export interface StagedPeerPull {
  peerId: string;
  peerLabel: string;
  bundleId: string;
  expiresAt: string;
  entityCount: number;
  blobManifest: readonly string[];
  blobsDownloaded: readonly string[];
  blobsAlreadyPresent: readonly string[];
  blobsUnavailable: readonly string[];
  blobsDeferred: readonly string[];
}

/**
 * Builds the pull operation bound to a host's credential resolver and outbound transport.
 * @returns `pullAndStageFromPeer`.
 * @complexity O(1) wiring.
 * @example const pullAndStageFromPeer = createPullAndStageFromPeer({ host })
 */
export function createPullAndStageFromPeer<D extends PublishContentPullDeps>({ host }: { host: PublishContentPullHost<D> }, _optional = {}) {
  /**
   * Fetches a saved peer's content and verified blobs, then stages it locally for the import gateway.
   * The authenticated caller owns the staged bundle; peer-declared identities are never trusted.
   * Blobs precede staging so a corrupt response cannot leave a staged bundle. Already verified blobs
   * may remain after a later failure, as ordinary content-addressed objects managed by blob GC.
   * @returns The existing HTTP pull response. No content entities are applied.
   * @throws Typed credential, transport or staging errors; callers handle their own boundary mapping.
   * @complexity O(e + b) space/work for entities and blobs; downloads retain the transport's cap.
   * @example await pullAndStageFromPeer(deps, { peerId: "live", principalId: "owner" });
   */
  return async function pullAndStageFromPeer(
    { deps, input }: {
      deps: D;
      input: { peerId: string; principalId: string };
    },
    _options = {},
  ): Promise<StagedPeerPull> {
    const credential = await host.resolveCredential({ deps, input: { workspaceId: deps.workspaceId, id: input.peerId } });
    const peer = { credential, httpClient: deps.publishContentPeerHttpClient };
    const envelope = await host.pullBundleFromPeer(peer);
    // Fetch blobs before staging: planImport blocks rows with missing local bytes, so bytes arriving
    // after planning would make the plan stale immediately. A hash mismatch aborts without staging.
    // Use this instance's workspace for local storage; the peer's workspace belongs only in its URL.
    const blobs = await host.pullBlobsFromPeer({
      deps: {
        ...peer,
        blobSink: deps.blobStore,
        workspaceId: deps.workspaceId,
        computeStorageKey: ({ sha256 }: { sha256: string }, _o: Record<string, never> = {}) => computeBlobStorageKey({ workspaceId: deps.workspaceId, sha256 }),
      },
      required: { blobManifest: envelope.blobManifest },
    });
    const staged = await stageBundle({
      input: {
        // The common staging path computes expiry server-side and binds baselines to the authenticated
        // principal. A peer-declared identity must never claim another operator's sync memory.
        workspaceId: deps.workspaceId,
        sourcePrincipalId: input.principalId,
        artifactFormatVersion: envelope.artifactFormatVersion,
        hashVersion: envelope.hashVersion,
        sourceLabel: envelope.sourceLabel,
        entities: envelope.entities,
        blobManifest: envelope.blobManifest,
      },
      deps: { repo: deps.publishContentBundleRepo, clock: deps.clock, idGen: deps.idGen },
    });
    return {
      peerId: credential.id,
      peerLabel: credential.label,
      ...staged,
      entityCount: envelope.entities.length,
      blobManifest: envelope.blobManifest,
      blobsDownloaded: blobs.downloaded,
      blobsAlreadyPresent: blobs.alreadyPresent,
      // Missing peer bytes are reported so the local plan blocks dependent rows, matching push's
      // fail-closed outcome. Over-cap blobs are deferred rather than lost; another pull fetches them.
      blobsUnavailable: blobs.unavailable,
      blobsDeferred: blobs.deferredOverCap,
    };
  };
}
