/**
 * @file Decides which ledger revisions a given caller may be TOLD about, and which namespaces that
 * implies. Kept as pure logic here so a host's transport layer (an SSE/polling route, a websocket
 * push) can be tested without an HTTP server or a clock.
 *
 * ## Why a change feed exists at all
 *
 * A settings write made in one process is invisible to an already-rendered admin tab in another.
 * That is true for a background daemon (a separate OS process) and equally true for a second
 * browser tab, another operator, or a background job. The revision ledger is the one place every
 * write lands regardless of who made it, and its `seq` is a monotonic autoincrement in shared
 * storage — so polling it is cross-process by construction, needing no IPC and no message broker.
 *
 * ## The disclosure rule
 *
 * A subscriber must not learn that settings it cannot read have changed. Even a bare namespace name
 * is a signal — "someone else's preferences just changed" is information the caller was never
 * granted. {@link isRevisionVisibleTo} is therefore an allowlist, not a denylist: an unrecognized
 * scope is withheld rather than passed through, so a future scope added to `SettingScope` is
 * invisible until someone decides what it should mean here.
 *
 * Nothing in the emitted payload carries a VALUE. Subscribers receive namespace names and re-read
 * through the ordinary authorized read path, which is what keeps this module's responsibility
 * narrow: it decides who hears that something moved, never what it moved to.
 */
import type { SettingRevisionRecord } from "./types.js";

/** The caller a change feed is being filtered for. */
export interface ChangeFeedViewer {
  /** The workspace whose admin surface is subscribed. */
  workspaceId: string;
  /** The subscribing principal — the only one whose user-layer changes are disclosed. */
  principalId: string;
}

/**
 * Whether `revision` may be disclosed to `viewer`.
 *
 * - **`global`** — platform-wide values every workspace resolves through. Disclosed.
 * - **`workspace`** — disclosed only for the viewer's own workspace (tenant scoping).
 * - **`user`** — disclosed only when the viewer IS the target principal. Another operator's
 *   preference changing is not the viewer's business, and telling them would leak both that the
 *   other principal exists and that they are active right now.
 * - **definition revisions** (`entityKind: 'definition'`, which carry `scope: null`) — these
 *   retype, rename, deprecate, or tombstone a definition, changing how every stored value for that
 *   key is interpreted. Workspace-scoped by the definition's own `workspaceId`, with `null` meaning
 *   a platform definition visible to all.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function isRevisionVisibleTo(revision: SettingRevisionRecord, viewer: ChangeFeedViewer): boolean {
  if (revision.entityKind === "definition") {
    return revision.workspaceId === null || revision.workspaceId === viewer.workspaceId;
  }

  switch (revision.scope) {
    case "global":
      return true;
    case "workspace":
      return revision.workspaceId === viewer.workspaceId;
    case "user":
      return revision.workspaceId === viewer.workspaceId && revision.principalId === viewer.principalId;
    default:
      // Allowlist, not denylist — see this module's header.
      return false;
  }
}

/** One batch of visible changes, plus the cursor a subscriber resumes from. */
export interface ChangeFeedBatch {
  /** Namespaces to re-read, de-duplicated. Empty when nothing visible changed. */
  namespaces: string[];
  /** The highest `seq` examined — advanced even when nothing was visible, so a stream of writes the
   *  viewer cannot see does not make it re-examine them forever. */
  cursor: number;
}

/**
 * Reduces raw revisions into the namespaces `viewer` should re-read.
 *
 * `resolveNamespace` returns `null` for a revision whose definition can no longer be resolved (a
 * tombstoned or since-deleted setting). Those advance the cursor but emit nothing: there is no
 * namespace to name, and inventing one would send subscribers chasing a key that is gone.
 *
 * @param revisions - Ledger rows, ascending by `seq`.
 * @param viewer - The subscriber to filter for.
 * @param resolveNamespace - Maps a `settingId` to its namespace, or `null` if unresolvable.
 * @returns The namespaces to refresh and the cursor to resume from.
 * @complexity O(n) in `revisions`, plus one `resolveNamespace` per visible revision.
 * @overallScore 100
 */
export async function collectChangedNamespaces(
  revisions: readonly SettingRevisionRecord[],
  viewer: ChangeFeedViewer,
  resolveNamespace: (settingId: string) => Promise<string | null>,
): Promise<ChangeFeedBatch> {
  const namespaces = new Set<string>();
  let cursor = 0;

  for (const revision of revisions) {
    if (revision.seq > cursor) cursor = revision.seq;
    if (!isRevisionVisibleTo(revision, viewer)) continue;
    const namespace = await resolveNamespace(revision.settingId);
    if (namespace) namespaces.add(namespace);
  }

  return { namespaces: [...namespaces], cursor };
}
