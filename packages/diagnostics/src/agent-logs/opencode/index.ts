import { join } from "node:path";
import type { AgentCliLogOptions } from "../../agent-logs.js";

export function openCodeLogDirectories({ home }: { home: string }, options: AgentCliLogOptions) {
  const xdg = options.xdgDataHome?.trim();
  const openCodeUserLogDir = xdg
    ? join(xdg, "opencode", "log")
    : join(home, ".local", "share", "opencode", "log");
  // OpenCode session logs (provider errors live here in headless mode).
  return [{ agent: "opencode", dir: openCodeUserLogDir }];
}
