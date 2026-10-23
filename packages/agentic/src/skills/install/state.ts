import path from "node:path";
import { validateGitHubSkillSource, type GitHubSkillSource } from "./github.js";
import type { SkillFilesystemPort, SkillSourceValidatorPort } from "./ports.js";

export interface SkillState<Source extends object = GitHubSkillSource> { readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource | Source }

const MAX_STATE_BYTES = 8192;
const INVALID_STATE = "Invalid skill installation record.";

/** Missing legacy records default to enabled; malformed records and symlinks fail closed. */
export async function readSkillState<Source extends object = GitHubSkillSource>(required: { directory: string; stateFileName: string; filesystem: SkillFilesystemPort; validateSource?: SkillSourceValidatorPort | undefined }, _optional: Record<string, never> = {}): Promise<SkillState<Source>> {
  const statePath = path.join(required.directory, required.stateFileName);
  let bytes: Uint8Array;
  try {
    const info = await required.filesystem.lstat({ path: statePath });
    if (info.kind !== "file" || info.size > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
    bytes = await required.filesystem.readFile({ path: statePath, maxBytes: MAX_STATE_BYTES });
    if (bytes.length > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, source: "uploaded" };
    throw error;
  }
  // Only missing filesystem records get legacy defaults; provider validation errors must fail closed.
  const state: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isSkillState({ value: state, validateSource: required.validateSource ?? validateGitHubSkillSource })) throw new Error(INVALID_STATE);
  return state as SkillState<Source>;
}

/** A boolean enabled plus uploaded or provenance accepted by the owning provider. */
function isSkillState({ value, validateSource }: { value: unknown; validateSource: SkillSourceValidatorPort }, _optional: Record<string, never> = {}): boolean {
  const state = value as { enabled?: unknown; source?: unknown } | null;
  if (!state || typeof state.enabled !== "boolean") return false;
  if (state.source === "uploaded") return true;
  if (!state.source || typeof state.source !== "object" || Array.isArray(state.source)) return false;
  return validateSource({ source: state.source }, {});
}
