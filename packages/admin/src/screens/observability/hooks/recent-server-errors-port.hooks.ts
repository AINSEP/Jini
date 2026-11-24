import type { ServerLogFilters, ServerLogsResult } from "@jini-ai/core/contracts/site/platform-server-logs";

/**
 * @file What `use-recent-server-errors.hooks.ts` needs from the outside world — same port split as
 * `observability-status-port.hooks.ts`. `copyText` has the shape of `@jini-ai/ui`'s
 * `ViewerClipboardPort`, so this port is passed straight to `useCopyToClipboard`.
 */
export interface RecentServerErrorsPort {
  getServerLogs(query: ServerLogFilters, optional?: Record<string, never>): Promise<ServerLogsResult>;
  /** Puts `text` on the clipboard; resolves `false` when the browser refused. */
  copyText(text: string): Promise<boolean>;
}
