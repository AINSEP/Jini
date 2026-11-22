import { join } from "node:path";
import type { AgentCliLogOptions } from "../../agent-logs.js";

export function codexLogDirectories({ home }: { home: string }, options: AgentCliLogOptions) {
  // Honor the effective CLI home so relocated configurations are not missed.
  const codexHome = options.codexHome?.trim() || join(home, ".codex");
  // Codex tracing logs (codex-tui.log can be very large — tail-bounded).
  return [{ agent: "codex", dir: join(codexHome, "log") }];
}
