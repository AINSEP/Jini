import type { ChangeFeedBatch } from '@jini-ai/core/settings';
import type { SettingRevisionRecord } from '@jini-ai/core/settings';

export type FeedAccess = { settings: boolean; preview: boolean };

/** How often the ledger is checked. Fast enough that a change feels immediate, slow enough that an
 *  idle tab costs ~1 indexed lookup/sec. */
const POLL_INTERVAL_MS = 1_000;
/** Comment frames keep proxies and load balancers from reaping an idle connection. */
const KEEPALIVE_INTERVAL_MS = 25_000;
/**
 * How often an open stream re-checks that its principal is still allowed to read
 * settings.
 *
 * A long-lived SSE connection outlives the single `authorize()` call that opened
 * it, so revoking a principal's `settings.read` did not stop the change
 * notifications already flowing to their open tab — the grant was effectively
 * pinned for as long as they kept the connection. Re-checking on a slow interval
 * rather than per tick keeps the cost near zero (one authorize per 30s per
 * stream, versus one per second) while bounding the revocation window.
 */
const REAUTHORIZE_INTERVAL_MS = 30_000;
/** Ledger rows examined per tick. Bounds a client resuming after a long absence — the remainder is
 *  drained on the following ticks rather than loaded at once. */
const REVISION_PAGE_SIZE = 200;

type ChangeFeedState = {
  access: FeedAccess; cursor: number;
  /** The last id written to the wire — workspace-scoped, unlike `cursor`. See where it is emitted. */
  lastEmittedId: number;
  closed: boolean;
  /** True while a `tick` is mid-flight — see the guard at the top of `tick`. */
  ticking: boolean;
};

export const settingsEventsRoute = {
  method: 'get' as const, path: '/api/admin/v1/workspaces/:workspaceId/settings/events',
  async open<Timer>({ workspaceId, initialAccess, lastEventId, afterRevision, ports }: {
    workspaceId: string; initialAccess: FeedAccess; lastEventId: string | undefined; afterRevision: unknown;
    ports: {
      writeHead(required: Record<string, never>): void;
      write(required: { frame: string }): void;
      end(required: Record<string, never>): void;
      onClose(required: { close: () => void }): void;
      schedule(required: { work: () => void; ms: number }): Timer;
      clear(required: { timer: Timer }): void;
      readHead(required: Record<string, never>): Promise<number>;
      readRevisions(required: { workspaceId: string; sinceSeq: number; limit: number }): Promise<readonly SettingRevisionRecord[]>;
      collect(required: { revisions: readonly SettingRevisionRecord[] }): Promise<ChangeFeedBatch>;
      reauthorize(required: Record<string, never>): Promise<FeedAccess>;
      previewTick(required: Record<string, never>): void;
      report(required: { phase: 'head' | 'poll' | 'reauthorize'; error: unknown }): void;
      headFailureText: string;
    };
  }, _optional = {}): Promise<void> {
    ports.writeHead({});
    const head = await readHeadOrEndStream({ ports });
    if (head === null) return;
    runChangeFeed({ workspaceId, initialAccess, ports, cursor: resumeCursor({ lastEventId, afterRevision, head }) });
  },
};

/**
 * Resume point. `Last-Event-ID` is set by the browser automatically on `EventSource`'s own
 * reconnect, so a dropped connection replays the writes missed in the gap instead of silently
 * skipping them. A fresh subscriber starts at the current head — it has just loaded its values,
 * so replaying history would only make it re-read what it already has. Explicit tab handoff
 * or visibility reconnect uses afterRevision because a new EventSource cannot set headers.
 * Native Last-Event-ID takes precedence after that new source automatically reconnects.
 *
 * It is nonetheless client-supplied input naming a position in a ledger shared by every
 * workspace, so it is clamped INTO the ledger. An id past the head would otherwise park the
 * cursor in the future, and `seq > cursor` would then match nothing for as long as the tab
 * stayed open — a feed that is silently and permanently dead while still looking connected.
 *
 * @complexity O(1).
 */
function resumeCursor({ lastEventId, afterRevision, head }: { lastEventId: string | undefined; afterRevision: unknown; head: number }): number {
  const resumeFrom = Number(lastEventId ?? (typeof afterRevision === 'string' ? afterRevision : undefined));
  return Number.isFinite(resumeFrom) && resumeFrom >= 0 ? Math.min(resumeFrom, head) : head;
}

/**
 * Reads the ledger head after the stream's headers are already sent. A failure here cannot become
 * an HTTP error any more, so it is turned into one `error` event in plain words and the stream is
 * ended: without it the open tab sat silent, believing live updates were still coming. The raw
 * cause goes to the server log only, since it may carry a path or a SQL fragment.
 * @returns The head sequence, or `null` once the stream has been ended.
 * @complexity O(1) plus one indexed read.
 */
async function readHeadOrEndStream({ ports }: { ports: Pick<Parameters<typeof settingsEventsRoute.open>[0]['ports'], 'readHead' | 'report' | 'write' | 'end' | 'headFailureText'> }): Promise<number | null> {
  try { return await ports.readHead({}); }
  catch (error) {
    ports.report({ phase: 'head', error });
    ports.write({ frame: `event: error\ndata: ${JSON.stringify({ code: 'FEED_UNAVAILABLE', message: ports.headFailureText })}\n\n` });
    ports.end({});
    return null;
  }
}

function runChangeFeed<Timer>({ workspaceId, initialAccess, ports, cursor }: Pick<Parameters<typeof settingsEventsRoute.open<Timer>>[0], 'workspaceId' | 'initialAccess' | 'ports'> & { cursor: number }): void {
  const state: ChangeFeedState = { access: initialAccess, cursor, lastEmittedId: cursor, closed: false, ticking: false };
  const timers: Timer[] = [];
  const close = (): void => {
    if (state.closed) return;
    state.closed = true;
    for (const timer of timers) ports.clear({ timer });
  };
  const reauthorize = createChangeFeedReauthorizer({ ports }, state, close);
  const emitSettingsChange = createSettingsChangeEmitter({ ports }, state);
  const tick = createChangeFeedTick({ workspaceId, ports }, state, { emitSettingsChange });
  timers.push(ports.schedule({ work: () => tick(), ms: POLL_INTERVAL_MS }));
  timers.push(ports.schedule({ work: () => { if (!state.closed) ports.write({ frame: ': keepalive\n\n' }); }, ms: KEEPALIVE_INTERVAL_MS }));
  timers.push(ports.schedule({ work: () => reauthorize(), ms: REAUTHORIZE_INTERVAL_MS }));
  // `close` fires on tab close, navigation, and `EventSource.close()` alike. Without this the
  // timers outlive the response and every reconnect leaks another pair.
  ports.onClose({ close });
  // An opening comment flushes headers immediately, so the client's `onopen` fires now rather
  // than whenever the first real change happens to arrive.
  ports.write({ frame: ': connected\n\n' });
}

/**
 * Re-runs the same authorization that opened the stream, and ends it the
 * moment that stops holding or cannot be confirmed.
 *
 * Fail closed on errors: a later channel check may throw after settings.read was denied,
 * leaving the cached grant unchanged. Closing also suppresses any poll already in flight.
 */
function createChangeFeedReauthorizer({ ports }: { ports: Pick<Parameters<typeof settingsEventsRoute.open>[0]['ports'], 'reauthorize' | 'report' | 'end'> }, state: ChangeFeedState, close: () => void) {
  return async (): Promise<void> => {
    if (state.closed) return;
    try {
      state.access = await ports.reauthorize({});
      // Each channel is authorized independently; a theme-only subscriber never gets namespaces.
      if (state.closed || state.access.settings || state.access.preview) return;
    } catch (error) { ports.report({ phase: 'reauthorize', error }); }
    close();
    ports.end({});
  };
}

/** Write one visible batch, checking the current grant again after the ledger reads. */
function createSettingsChangeEmitter({ ports }: { ports: Pick<Parameters<typeof settingsEventsRoute.open>[0]['ports'], 'write'> }, state: ChangeFeedState) {
  return (batch: ChangeFeedBatch): void => {
    if (state.closed || !state.access.settings || batch.namespaces.length === 0) return;
    // Emit the WORKSPACE-scoped position, not the internal `cursor`.
    //
    // `cursor` is advanced to the global ledger head so this connection can
    // skip past other tenants' rows, but the id is the one part of the frame
    // a subscriber can read. Emitting the global head would let a tab watch
    // its own event ids jump and count another workspace's write volume — a
    // metadata channel that only exists because the ledger is shared. The
    // workspace-scoped `batch.cursor` is a valid resume point: reconnecting
    // from it re-examines rows already examined, which the workspace
    // predicate makes cheap, and cannot skip anything.
    state.lastEmittedId = Math.max(state.lastEmittedId, batch.cursor);
    ports.write({ frame: `id: ${state.lastEmittedId}\n` });
    ports.write({ frame: 'event: settings-changed\n' });
    ports.write({ frame: `data: ${JSON.stringify({ namespaces: batch.namespaces })}\n\n` });
  };
}

/**
 * One poll. Never throws: a transient read failure must not tear down a subscription the client
 * would then reconnect anyway, and `cursor` is left untouched so the same window is re-examined
 * on the next tick rather than skipped.
 */
function createChangeFeedTick({ workspaceId, ports }: Pick<Parameters<typeof settingsEventsRoute.open>[0], 'workspaceId'> & { ports: Pick<Parameters<typeof settingsEventsRoute.open>[0]['ports'], 'previewTick' | 'readHead' | 'readRevisions' | 'collect' | 'report'> }, state: ChangeFeedState, { emitSettingsChange }: { emitSettingsChange: (batch: ChangeFeedBatch) => void }) {
  return async (): Promise<void> => {
    if (state.closed || state.ticking) return;
    // `setInterval` does not await an async callback, and one tick does two
    // repo round trips plus a definition lookup per visible revision. A tick
    // slower than the poll interval would otherwise have the next one start
    // mid-await: both read the same `cursor`, both query the same window, both
    // can emit the same frame, and the `cursor` write becomes a lost update.
    state.ticking = true;
    try {
      if (!state.closed && state.access.preview) ports.previewTick({});
      if (!state.access.settings) return;
      // Read the head BEFORE the page, so every row counted by it was already durable when the
      // query below ran. Reading it after would let a concurrent write inflate the head past rows
      // the query never had a chance to see, and the cursor advance would skip them.
      const ledgerHead = await ports.readHead({});
      const revisions = await ports.readRevisions({ sinceSeq: state.cursor, limit: REVISION_PAGE_SIZE, workspaceId });
      const batch = await ports.collect({ revisions });
      // Advance even when nothing was visible, so writes this viewer cannot see are examined once
      // rather than on every tick forever.
      //
      // A SHORT page is what makes that true now that the query is workspace-filtered: fewer than
      // `REVISION_PAGE_SIZE` rows means the predicate ran out of matches before it ran out of
      // ledger, so everything up to `ledgerHead` has been examined and can be skipped past.
      // Advancing only to `batch.cursor` would leave the cursor parked behind a busy neighbour's
      // rows and re-walk them on every tick for the life of the connection.
      const examined = revisions.length < REVISION_PAGE_SIZE ? ledgerHead : batch.cursor;
      state.cursor = Math.max(state.cursor, examined, batch.cursor);
      emitSettingsChange(batch);
    } catch (error) { ports.report({ phase: 'poll', error }); }
    finally { state.ticking = false; }
  };
}

/**
 * Response headers for this SSE stream's opening `writeHead()`, minus `Connection` on an HTTP/2
 * request. Node's http2 compatibility layer throws `ERR_HTTP2_INVALID_CONNECTION_HEADER` the moment
 * a `connection` header reaches `writeHead()` — HTTP/2 has no per-hop connection semantics for it to
 * describe. Dropping it there costs nothing real: `keep-alive` was never anything but HTTP/1.1's
 * already-default behavior for a persistent connection, so omitting the header changes no observable
 * behavior for an HTTP/1.1 client, only stops a header HTTP/2 cannot accept from being sent to one.
 *
 * @param req - the originating request; only `httpVersionMajor` is read.
 * @complexity O(1).
 */
export function sseWriteHeadHeaders({ httpVersionMajor }: { httpVersionMajor: number }, _optional = {}): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    ...(httpVersionMajor < 2 ? { Connection: "keep-alive" } : {}),
    // Defeats nginx response buffering, which otherwise holds frames until the buffer fills —
    // indistinguishable from the feed being broken.
    "X-Accel-Buffering": "no",
  };
}

/**
 * Admission for one subscription: 404 for another workspace, 401 when settings are not ready or
 * nobody is authenticated, 403 when neither the settings nor the theme-preview channel is granted.
 * Writes the refusal itself and returns null; otherwise returns who was admitted to what.
 * @complexity O(1) plus one or two authorizer calls.
 */
export async function admitSubscriber({ deps }: { deps: {
  rejectForeignWorkspace: () => boolean;
  settingsReady: PromiseLike<unknown>;
  principal: () => { id: string };
  report: (error: unknown) => void;
  includePreview: () => boolean;
  authorize: (required: { principalId: string; includePreview: boolean }) => Promise<{ settings: boolean; preview: boolean; reason: string }>;
  json: (body: unknown, status: number) => void;
} }, _optional = {}): Promise<{ principal: { id: string }; access: { settings: boolean; preview: boolean; reason: string }; includePreview: boolean } | null> {
  if (deps.rejectForeignWorkspace()) return null;

  let principal: { id: string };
  try {
    await deps.settingsReady;
    principal = deps.principal();
  } catch (err) {
    deps.report(err);
    deps.json({ error: "unauthenticated", code: "UNAUTHENTICATED" }, 401);
    return null;
  }

  const includePreview = deps.includePreview();
  const access = await deps.authorize({ principalId: principal.id, includePreview });
  if (!access.settings && !access.preview) {
    deps.json({
      error: `principal '${principal.id}' is not authorized for 'settings.read' (${access.reason})`,
      code: "FORBIDDEN",
      details: { permission: "settings.read", reason: access.reason },
    }, 403);
    return null;
  }
  return { principal, access, includePreview };
}

export function createNamespaceResolver({ deps }: { deps: { settingsRepo: { findDefinitionBySettingId: (required: { settingId: string }) => Promise<{ namespace: string } | null> } } }, _optional = {}) {


  /** Namespace per settingId, cached for the connection's life: a settingId's namespace changes
   *  only via `renameDefinition`, which appends its own revision and so re-notifies anyway. */
  const namespaceBySettingId = new Map<string, string | null>();
  const resolveNamespace = async ({ settingId }: { settingId: string }, _options: Record<string, never> = {}): Promise<string | null> => {
    const cached = namespaceBySettingId.get(settingId);
    if (cached !== undefined) return cached;
    const definition = await deps.settingsRepo.findDefinitionBySettingId({ settingId });
    const namespace = definition?.namespace ?? null;
    namespaceBySettingId.set(settingId, namespace);
    return namespace;
  };
  return resolveNamespace;
}
