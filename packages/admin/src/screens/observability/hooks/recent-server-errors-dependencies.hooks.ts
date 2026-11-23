import type { AdminServerLogs } from "../api/observability-api.types.js";
import type { ObservabilityApi } from "../api/observability-api.js";
import type { RecentServerErrorsPort } from "./recent-server-errors-port.hooks.js";

/** @file The only place the Recent errors hook reaches the API client and the clipboard, plus its in-memory test fake. */

/**
 * The live port: server logs through the host-bound {@link ObservabilityApi} (read at call time),
 * copy through the host's clipboard (a browser clipboard port the host builds once).
 */
export function createRecentServerErrorsPort(
  { api, clipboard }: { api: Pick<ObservabilityApi, "getServerLogs">; clipboard: Pick<RecentServerErrorsPort, "copyText"> },
  _optional: Record<string, never> = {},
): RecentServerErrorsPort {
  return {
    getServerLogs: (query, _optional = {}) => api.getServerLogs(query),
    copyText: (text) => clipboard.copyText(text),
  };
}

export interface FakeRecentServerErrorsPortOptions {
  logs?: AdminServerLogs;
  failWith?: unknown;
  /** What `copyText` resolves; defaults to `true`. */
  copyResult?: boolean;
}

/** An in-memory {@link RecentServerErrorsPort} that records each query it was asked and each text it copied. */
export function createFakeRecentServerErrorsPort(options: FakeRecentServerErrorsPortOptions = {}): RecentServerErrorsPort & { queries: unknown[]; copied: string[] } {
  const queries: unknown[] = [];
  const copied: string[] = [];
  return {
    queries,
    copied,
    async getServerLogs(query, _optional = {}) {
      queries.push(query);
      if (options.failWith !== undefined) throw options.failWith;
      return options.logs ?? { entries: [], matched: 0, buffered: 0, truncated: false, capturing: true };
    },
    async copyText(text) {
      copied.push(text);
      return options.copyResult ?? true;
    },
  };
}
