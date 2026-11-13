import { join } from "node:path";
import type { AgentCliLogOptions } from "../../agent-logs.js";

export function claudeLogDirectories({ home }: { home: string }, options: AgentCliLogOptions) {
  // Honor the effective CLI home so relocated configurations are not missed.
  const claudeDir = options.claudeConfigDir?.trim() || join(home, ".claude");
  // Claude Code operational logs (bash-commands / cost-tracker / daemon).
  return [{ agent: "claude", dir: claudeDir }];
}
