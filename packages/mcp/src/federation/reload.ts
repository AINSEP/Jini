import type { Logger } from "@jini-ai/core/primitives";
import { attachFederatedMcpTools, type AttachFederatedMcpToolsParams, type AttachFederatedToolsResult } from "./bootstrap.js";
import type { ResolvedFederatedConnection } from "./config.js";
import type { FederationDeps } from "./registrations.js";

/**
 * @file Hot re-admission of federated MCP connections — the piece that lets an owner who finishes an
 * external MCP sign-in (or an operator who saves a ready, non-OAuth connection) see its tools without
 * restarting the daemon. Before this file existed, `agent-daemon-server.ts`'s `start()` called
 * `attachFederatedMcpTools` exactly once, at boot; a connection that did not exist (or was not yet
 * authorized) at that moment contributed no tools until the whole process restarted — see that file's
 * `registerFederationReloadRoute` call site for how an operator-authorized event now reaches here.
 *
 * ## What this does NOT do, on purpose
 *
 * `trust.ts` R5 freezes an ALREADY-ADMITTED connection's tool set at connect, forever, for this
 * process's lifetime — the rug-pull protection that file's own header explains. This module never
 * re-lists, re-classifies, or re-admits a connectionId that has already gone through
 * {@link attachFederatedMcpTools} once, whether that pass ran at boot or at an earlier reload
 * ({@link selectUnadmittedConnections} is the whole enforcement mechanism: a connectionId already in
 * `admittedConnectionIds` is filtered out before `attach` is ever called on it again). It only ever
 * widens the set of connections that have been admitted AT ALL — new rows, never revised ones — which
 * is the same guarantee a fresh boot already gives, just applied to a connection that did not exist
 * yet when this process started. `ToolRegistry` (`@jini-ai/core`) is deliberately append-only with no
 * unregister, so this module still has no way to revise or drop an admitted tool even if it wanted to.
 *
 * That admission freeze no longer means an operator's edit is inert until restart, though —
 * `external-mcp-revocation.ts`'s per-call gate (`mcp-federation/registrations.ts`'s
 * `FederationDeps.assertConnectionUsable`) re-reads the connection's row on every call, independent of
 * this reload path. Turning a connection off, deleting it, disconnecting its OAuth, or narrowing its
 * allowlist or write list all take effect on the very NEXT call, with no restart and no reload
 * required. Widening the allowlist, or changing the server's address, command, args or sign-in method,
 * still needs a real restart: the new tools are never registered, and the old ones refuse as
 * `"changed"` (the row's admission revision no longer matches what the tool was admitted under) until
 * the process restarts and re-admits the connection fresh.
 *
 * ## Concurrency
 *
 * {@link createFederationReloadCoordinator} is the single owner of "which connectionIds have been
 * admitted so far" and serializes every reload attempt through one coalesced, trailing-edge
 * single-flight queue — see {@link FederationReloadCoordinator.reload}'s own doc for why a NAIVE
 * single-flight (return the already-in-flight promise to every caller) is wrong here: it can report
 * success to a caller whose own just-committed connection the in-flight pass never saw. Two operator
 * actions landing close together (two OAuth callbacks finishing within the same tick, or a callback
 * racing an admin PUT) can never interleave into a half-updated `ToolRegistry`, and neither can ever
 * cause the append-only registry's "already registered" throw by attempting the same connectionId
 * twice concurrently.
 */

/**
 * Every roster connection not yet admitted, in roster order. Pure — no I/O — so it is testable in
 * isolation from the I/O `createFederationReloadCoordinator` performs.
 *
 * @complexity O(n) in the roster size.
 */
export function selectUnadmittedConnections({ allConnections, admittedConnectionIds }: { allConnections: readonly ResolvedFederatedConnection[]; admittedConnectionIds: ReadonlySet<string> }
): readonly ResolvedFederatedConnection[] {
  return allConnections.filter((connection) => !admittedConnectionIds.has(connection.config.connectionId));
}

export interface FederationReloadResult {
  /** Ids newly admitted by THIS reload pass — empty when nothing in the roster was unadmitted. */
  readonly newlyAdmittedConnectionIds: readonly string[];
  /** This pass's own admission reports only, in `attachFederatedMcpTools`'s own shape — the caller
   *  (`agent-daemon-server.ts`) merges these into the running, boot-plus-every-reload accounting
   *  `GET /api/federation/admissions` serves; this module holds no history beyond `admittedConnectionIds`. */
  readonly reports: AttachFederatedToolsResult["reports"];
  /** This pass's own connect failures only (2026-09-24) — a connection the reload attempted that
   *  never reached admission, same shape and same merge-at-the-caller discipline as `reports`. A
   *  connectionId that fails a reload is NOT added to `admittedConnectionIds`, so the next reload
   *  attempts it again rather than treating one failed attempt as permanent. */
  readonly connectFailures: AttachFederatedToolsResult["connectFailures"];
}

export interface FederationReloadCoordinatorDeps {
  readonly registry: AttachFederatedMcpToolsParams["registry"];
  readonly deps: FederationDeps;
  readonly connect: AttachFederatedMcpToolsParams["connect"];
  /** Reads the operator's current roster fresh. Called once per actual reload PASS — never once per
   *  `reload()` caller; see the coalescing doc on {@link FederationReloadCoordinator.reload}. */
  readonly resolveConnections: () => Promise<readonly ResolvedFederatedConnection[]>;
  /** Test seam — defaults to the real {@link attachFederatedMcpTools}. */
  readonly attach?: typeof attachFederatedMcpTools | undefined;
  readonly logger?: Logger | undefined;
}

export interface FederationReloadCoordinator {
  /**
   * Re-admits every roster connection not yet admitted.
   *
   * Coalesced trailing-edge single-flight: if a pass is already running, this does NOT hand back
   * that pass's own result (its `resolveConnections()` snapshot may predate whatever made THIS call
   * happen — a just-committed OAuth completion or admin save — so reporting it as this caller's
   * answer could claim success for a connection the running pass never saw), and it does NOT start a
   * second CONCURRENT pass either (two passes racing could both see the same connectionId as
   * unadmitted and both call `registry.register()` for it, tripping the append-only registry's
   * "already registered" throw). Instead it queues exactly one follow-up pass, run after the
   * in-flight one finishes, shared by every caller that arrives while one is already queued — so N
   * callers arriving close together cost at most two real passes: the one already running, plus one
   * guaranteed to read the roster after every one of those callers' own writes committed.
   */
  reload(required: Record<string, never>): Promise<FederationReloadResult>;
  /** Every connectionId admitted so far, boot-time seed included. A live read of the coordinator's
   *  own bookkeeping, not a snapshot — reflects the most recently SETTLED reload pass. */
  admittedConnectionIds(): ReadonlySet<string>;
}

/**
 * @param initiallyAdmitted - The connectionIds `start()`'s own boot-time `attachFederatedMcpTools`
 * call already admitted — seeded in so the first reload never re-attempts them.
 * @complexity `reload()` is O(c · t) in the unadmitted connection count and their advertised tools
 * (the underlying `attachFederatedMcpTools` cost); `admittedConnectionIds()` is O(1).
 */
export function createFederationReloadCoordinator({ coordDeps, initiallyAdmitted }: { coordDeps: FederationReloadCoordinatorDeps; initiallyAdmitted: Iterable<string> }
): FederationReloadCoordinator {
  const admitted = new Set(initiallyAdmitted);
  const attach = coordDeps.attach ?? attachFederatedMcpTools;

  let inFlight: Promise<FederationReloadResult> | null = null;
  let queuedNext: Promise<FederationReloadResult> | null = null;

  async function runOnePass(): Promise<FederationReloadResult> {
    const allConnections = await coordDeps.resolveConnections();
    const unadmitted = selectUnadmittedConnections({ allConnections: allConnections, admittedConnectionIds: admitted });
    if (unadmitted.length === 0) return { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] };

    // Empty, not omitted: omission resolves presets from the environment again, even though the
    // boot pass already admitted them. Reload concerns only the operator-editable roster;
    // environment presets cannot change without a real restart.
    const attached = await attach({ registry: coordDeps.registry, deps: coordDeps.deps, connect: coordDeps.connect }, { connections: [], extraConnections: unadmitted, ...(coordDeps.logger ? { logger: coordDeps.logger } : {}) });

    for (const entry of attached.reports) admitted.add(entry.connectionId);
    return {
      newlyAdmittedConnectionIds: attached.reports.map((entry) => entry.connectionId),
      reports: attached.reports,
      connectFailures: attached.connectFailures,
    };
  }

  function reload(_required: Record<string, never>): Promise<FederationReloadResult> {
    if (!inFlight) {
      inFlight = runOnePass().finally(() => {
        inFlight = null;
      });
      return inFlight;
    }
    if (!queuedNext) {
      // Chained off the CURRENTLY running pass, not reassigned into `inFlight` until it actually
      // starts — a third caller arriving while this follow-up is still only QUEUED (the running pass
      // hasn't settled yet) shares this same queued promise instead of queuing a third pass.
      // `.catch(() => undefined)` first so a broken run (`resolveConnections`/`attach` throwing,
      // possible only via test-injected overrides — the real ones this repo wires are documented
      // "never rejects") cannot wedge every future caller behind a permanently-rejected chain link.
      const runningPass = inFlight;
      queuedNext = runningPass.catch(() => undefined).then(() => {
        const nextPass = runOnePass().finally(() => {
          inFlight = null;
        });
        inFlight = nextPass;
        queuedNext = null;
        return nextPass;
      });
    }
    return queuedNext;
  }

  return { reload, admittedConnectionIds: () => admitted };
}
