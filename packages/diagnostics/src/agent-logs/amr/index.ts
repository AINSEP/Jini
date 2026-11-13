import { join } from "node:path";
import type { AgentCliLogOptions } from "../../agent-logs.js";

export function amrLogDirectories(_input: { home: string }, options: AgentCliLogOptions) {
  // An AMR-style runtime drives a private OpenCode under OPENCODE_TEST_HOME;
  // its session logs land under that home's XDG data dir, where provider
  // failures are recorded. Prefer the effective home a real run resolves
  // (honoring a user override) and fall back to the default
  // `<dataDir>/amr/opencode-home` so the bundle does not silently drop the
  // very logs this is meant to surface.
  const amrHome = options.amrOpenCodeHome?.trim();
  const dataDir = options.dataDir?.trim();
  const amrOpenCodeHome = amrHome || (dataDir ? join(dataDir, "amr", "opencode-home") : "");
  return amrOpenCodeHome
    ? [{ agent: "amr", dir: join(amrOpenCodeHome, ".local", "share", "opencode", "log") }]
    : [];
}
