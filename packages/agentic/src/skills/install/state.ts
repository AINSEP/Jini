import path from "node:path";
import { validateGitHubSkillSource, type GitHubSkillSource } from "./github.js";
import type { SkillFilesystemPort, SkillSourceValidatorPort } from "./ports.js";

export interface SkillState<Source extends object = GitHubSkillSource> { readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource | Source }

/**
 * The engine's own persisted install-state file name inside each skill folder. A host that already
 * shipped under another name keeps that name only as a READ fallback (`legacyStateFileNames`); every
 * write uses this one, so a later write makes this file authoritative without touching the old one.
 */
/** Persisted install-state file name inside each skill folder; keep it stable across releases. */
export const SKILL_STATE_FILE_NAME = ".skill-install.json";

const MAX_STATE_BYTES = 8192;
const INVALID_STATE = "Invalid skill installation record.";

/**
 * Missing legacy records default to enabled; malformed records and symlinks fail closed.
 * Read order is `stateFileName`, then each of `legacyStateFileNames`; the first file that EXISTS is the
 * record, so a present-but-broken new file fails closed rather than falling back to a stale legacy one.
 */
export async function readSkillState<Source extends object = GitHubSkillSource>(required: { directory: string; stateFileName: string; legacyStateFileNames?: readonly string[] | undefined; filesystem: SkillFilesystemPort; validateSource?: SkillSourceValidatorPort | undefined }, _optional: Record<string, never> = {}): Promise<SkillState<Source>> {
  const bytes = await readFirstStateFile({ ...required, names: [required.stateFileName, ...required.legacyStateFileNames ?? []] });
  if (bytes === undefined) return { enabled: true, source: "uploaded" };
  // Only missing filesystem records get legacy defaults; provider validation errors must fail closed.
  const state: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isSkillState({ value: state, validateSource: required.validateSource ?? validateGitHubSkillSource })) throw new Error(INVALID_STATE);
  return state as SkillState<Source>;
}

/** The bytes of the first named state file that exists, or `undefined` when none does. */
async function readFirstStateFile({ directory, names, filesystem }: { directory: string; names: readonly string[]; filesystem: SkillFilesystemPort }, _optional: Record<string, never> = {}): Promise<Uint8Array | undefined> {
  for (const name of names) {
    const statePath = path.join(directory, name);
    try {
      const info = await filesystem.lstat({ path: statePath });
      if (info.kind !== "file" || info.size > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
      const bytes = await filesystem.readFile({ path: statePath, maxBytes: MAX_STATE_BYTES });
      if (bytes.length > MAX_STATE_BYTES) throw new Error(INVALID_STATE);
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

/** A boolean enabled plus uploaded or provenance accepted by the owning provider. */
function isSkillState({ value, validateSource }: { value: unknown; validateSource: SkillSourceValidatorPort }, _optional: Record<string, never> = {}): boolean {
  const state = value as { enabled?: unknown; source?: unknown } | null;
  if (!state || typeof state.enabled !== "boolean") return false;
  if (state.source === "uploaded") return true;
  if (!state.source || typeof state.source !== "object" || Array.isArray(state.source)) return false;
  return validateSource({ source: state.source }, {});
}
