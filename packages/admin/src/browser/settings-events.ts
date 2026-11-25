/**
 * @file Subscribes to the server's settings change feed and republishes onto
 * `settings-refresh-bus.ts`, so a change made anywhere — another tab, another operator, a
 * background job, an agent run in a different window — reaches this tab's mounted settings tabs
 * without a page reload.
 *
 * ## How this differs from the run-completion trigger
 *
 * `components/AssistantDock/AssistantDock.tsx` already refreshes when an assistant run finishes in THIS tab.
 * That covers the common case immediately and needs no server support, but it is blind by
 * construction: it only knows about runs it hosted. This feed covers everything else, and the two
 * are deliberately independent — the dock keeps working if the feed is unavailable, and the feed
 * keeps working with the dock closed. Both land on the same bus, and a duplicate refresh is a
 * no-op read, so overlap costs nothing worth preventing.
 *
 * ## Reconnection is the browser's job, not ours
 *
 * `EventSource` reconnects on its own and replays `Last-Event-ID`, which the server honors as a
 * ledger cursor — so a dropped connection resumes at the revision it left off rather than silently
 * skipping the writes that happened in the gap. Hand-rolling that would mean reimplementing
 * backoff and resume for no gain, which is the reason this uses `EventSource` rather than `fetch`
 * streaming. Explicit ownership handoff preserves the last received id via `afterRevision`;
 * ordinary network retries still belong to the same native EventSource.
 */
import { startBrowserStream, type BrowserStreamPorts } from "../shell/lib/browser-stream.js";
import type { StreamActivity } from "../shell/lib/stream-activity.js";

/** Frame payload. Namespace names only — the server never sends values (see `change-feed.ts`). */
interface SettingsChangedFrame {
  namespaces?: readonly string[];
}

type Frame = { kind: string; data: string; id: string };
interface SettingsFeedState { cursor: string; supplementalRevision: string; opened: boolean }

export function subscribeToSettingsChanges({ workspaceId, principalId, open, ports, activity, urlFor, publishSettings, warn }: {
  workspaceId: string;
  principalId: string;
  open: (url: string) => Pick<EventSource, "addEventListener" | "close" | "readyState">;
  ports: BrowserStreamPorts;
  activity: StreamActivity;
  urlFor: (required: { workspaceId: string; cursor: string; supplementalRevision: string }) => string;
  publishSettings: (namespaces?: readonly string[]) => void;
  warn: (message: string, error?: unknown) => void;
}, { supplemental }: {
  supplemental?: { event: string; consume(required: { data: string }, optional?: Record<string, never>): string | undefined };
} = {}): () => void {
  const state: SettingsFeedState = {
    cursor: "",
    supplementalRevision: "",
    opened: false,
  };
  return startBrowserStream<Frame>({
    // Workspace and principal are both disclosure boundaries; never share across identities.
    key: `settings/${encodeURIComponent(workspaceId)}/${encodeURIComponent(principalId)}`,
    connect: createSettingsFeedConnector(state, { open, workspaceId, urlFor, warn }, { ...(supplemental === undefined ? {} : { supplemental }) }),
    receive: ({ frame }) => receiveSettingsFrame({ state, frame, publishSettings }, { ...(supplemental === undefined ? {} : { supplemental }) }),
  }, { ports, activity });
}

function receiveSettingsFrame({ state, frame, publishSettings }: {
  state: SettingsFeedState; frame: Frame; publishSettings: Parameters<typeof subscribeToSettingsChanges>[0]["publishSettings"];
}, { supplemental }: Parameters<typeof subscribeToSettingsChanges>[1] = {}): void {
  if (frame.id) state.cursor = frame.id;
  if (frame.kind === "open") {
    // A new leader/follower connection may have no cursor yet. Re-read after boot so a
    // handoff cannot leave stale values even when no settings frame preceded it.
    // Theme's durable marker replays independently.
    // The FIRST attach belongs to boot's fresh reads, not a change. Later opens still cover
    // reconnects/leadership handoffs, including those for which no cursor was received.
    // A prior frame can supply the resume cursor even if that source never emitted open.
    if (state.opened || state.cursor) publishSettings();
    state.opened = true;
    return;
  }
  if (supplemental && frame.kind === supplemental.event) {
    const revision = supplemental.consume({ data: frame.data });
    if (revision !== undefined) state.supplementalRevision = revision;
    return;
  }
  try {
    const changed = JSON.parse(frame.data) as SettingsChangedFrame;
    // A frame with no usable namespace list still means "something changed" — refresh everything
    // rather than dropping a notification because its payload shape was unexpected.
    publishSettings(Array.isArray(changed.namespaces) ? changed.namespaces : undefined);
  } catch { publishSettings(); }
}

function createSettingsFeedConnector(state: SettingsFeedState, { open, workspaceId, urlFor, warn }: Pick<Parameters<typeof subscribeToSettingsChanges>[0], "open" | "workspaceId" | "urlFor" | "warn">,
  { supplemental }: Parameters<typeof subscribeToSettingsChanges>[1] = {},
): Parameters<typeof startBrowserStream<Frame>>[0]["connect"] {
  return ({ emit }) => {
      let source: Pick<EventSource, "addEventListener" | "close" | "readyState">;
      try { source = open(urlFor({ workspaceId, cursor: state.cursor, supplementalRevision: state.supplementalRevision })); }
      catch (error) {
        warn("[admin] settings change feed unavailable", error);
        return () => {};
      }
      for (const kind of [...(supplemental ? [supplemental.event] : []), "settings-changed", "open"]) {
        source.addEventListener(kind, (event) => {
          const message = event as MessageEvent<string>;
          emit({ frame: { kind, data: message.data ?? "", id: message.lastEventId ?? "" } });
        });
      }
      // Deliberately not closed here: EventSource reconnects with backoff on its own, and a
      // transient blip must not permanently silence the feed for the tab's remaining lifetime.
      // Logged at debug volume because a reconnect is ordinary, not an incident.
      source.addEventListener("error", () => {
        if (source.readyState === 2) warn("[admin] settings change feed closed by the server; no further updates on this connection");
      });
      return () => source.close();
    };
}
