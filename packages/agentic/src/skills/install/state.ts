import path from "node:path";
import type { GitHubSkillSource } from "./github.js";
import type { SkillFilesystemPort } from "./ports.js";

export interface SkillState { readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource }

/** Missing legacy records default to enabled; malformed records and symlinks fail closed. */
export async function readSkillState(required: { directory: string; stateFileName: string; filesystem: SkillFilesystemPort }, _optional: Record<string, never> = {}): Promise<SkillState> {
  const statePath = path.join(required.directory, required.stateFileName);
  try {
    const info = await required.filesystem.lstat({ path: statePath });
    if (info.kind !== "file" || info.size > 8192) throw new Error("Invalid skill installation record.");
    const bytes = await required.filesystem.readFile({ path: statePath, maxBytes: 8192 });
    if (bytes.length > 8192) throw new Error("Invalid skill installation record.");
    const state: SkillState = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!state || typeof state.enabled !== "boolean" || (state.source !== "uploaded" && (!state.source || typeof state.source.githubUrl !== "string" || !/^[a-f0-9]{40}$/.test(state.source.commit)))) throw new Error("Invalid skill installation record.");
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, source: "uploaded" };
    throw error;
  }
}
