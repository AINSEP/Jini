import path from "node:path";
import type { GitHubSkillSource } from "./github.js";
import type { SkillFilesystemPort } from "./ports.js";

export interface SkillState { readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource }

const MAX_STATE_BYTES = 8192;
const INVALID_STATE = "Invalid skill installation record.";

/** Missing legacy records default to enabled; malformed records and symlinks fail closed. */
export async function readSkillState(required: { directory: string; stateFileName: string; filesystem: SkillFilesystemPort }, _optional: Record<string, never> = {}): Promise<SkillState> {
  const statePath = path.join(required.directory, required.stateFileName);
  try {
    const info = await required.filesystem.lstat({ path: statePath });
    if (info.kind !== "file" || info.size > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
    const bytes = await required.filesystem.readFile({ path: statePath, maxBytes: MAX_STATE_BYTES });
    if (bytes.length > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
    const state: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!isSkillState(state)) throw new Error(INVALID_STATE);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, source: "uploaded" };
    throw error;
  }
}

/** A boolean `enabled` plus either "uploaded" or a GitHub source pinned to a 40-hex commit. */
function isSkillState(value: unknown): value is SkillState {
  const state = value as SkillState | null;
  if (!state || typeof state.enabled !== "boolean") return false;
  if (state.source === "uploaded") return true;
  return !!state.source && typeof state.source.githubUrl === "string" && /^[a-f0-9]{40}$/.test(state.source.commit);
}
