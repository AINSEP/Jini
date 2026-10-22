import path from 'node:path';
import type { SkillLayoutPort } from './ports.js';

/**
 * One safe, indivisible path segment: lowercase alphanumerics in `-`/`.`-separated runs, with no
 * leading, trailing, or doubled separator. Mirrors `agent-plugins/layout.ts`'s own
 * `SAFE_ID_SEGMENT_PATTERN` — duplicated rather than imported (see this file's header) — and accepts
 * this instance's real workspace id (`workspace-local`, per `<site>/uploads/ws/workspace-local/`) as
 * well as every UUID.
 */
const SAFE_ID_SEGMENT_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
/** Bounds the segment so a caller cannot drive a pathological path length. */
const MAX_ID_SEGMENT_LENGTH = 64;
// The segment grammar above moved from host features/skills/layout.ts; the sibling path in its
// historical rationale refers to host features/agent-plugins/layout.ts.

/**
 * Deliberately does NOT import anything from `src/features/agent-plugins/` — Agent Skills and Agent
 * Plugins are different things with their own directories (owner decision, above), and this file's
 * small id-segment guard is duplicated rather than shared, for the same reason
 * `capability-projection.ts`/`capability-source.ts` already duplicate their own `humanize` helper
 * between themselves: a private guard belonging to one small module, not a promise to keep two
 * independent features' internals in sync.
 */
// This paragraph records the original host module boundary; the private segment guard now
// belongs to this Jini layout owner, and the host keeps only the site-directory adapter.

/** Every storage location is host-owned; this adapter has no product or cwd defaults.
 * Layout resolves the same required root/stagingRoot/workspaceDirectory/stateFileName
 * contract used by the installer. No site, environment or cwd defaults are allowed: separate
 * workspace roots and staging roots keep installation writes inside the host's selected paths.
 */
export function createSkillLayout(required: { root: string; stagingRoot: string; workspaceDirectory: string; stateFileName: string }, _optional: Record<string, never> = {}): SkillLayoutPort {
  const { root, stagingRoot, workspaceDirectory, stateFileName } = required;
  if (!path.isAbsolute(root) || !path.isAbsolute(stagingRoot)) throw new Error('Skill roots must be absolute paths.');
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(workspaceDirectory)) throw new Error('Invalid workspace directory segment.');
  if (!stateFileName || /[/\\\x00]/.test(stateFileName) || ['.', '..', 'SKILL.md', 'README.md', 'LICENSE', 'references', 'scripts', 'assets'].includes(stateFileName)) throw new Error('Invalid skill state file name.');
  return Object.freeze({ resolve({ workspaceId }: { workspaceId: string }) {
    // Normalize BEFORE validating, not after — see `agent-plugins/layout.ts`'s own comment at the
    // identical line: the pattern is deliberately lowercase-only, and the normalized value is the
    // one that actually becomes the path segment, so it is the only value worth asserting about.
    const normalized = workspaceId.toLowerCase();
    if (normalized.length > MAX_ID_SEGMENT_LENGTH || !SAFE_ID_SEGMENT_PATTERN.test(normalized)) throw new Error(`resolve: '${workspaceId}' is not a valid workspace id`);
    return { workspaceRoot: path.join(root, workspaceDirectory, normalized), stagingRoot: path.resolve(stagingRoot), stateFileName };
  } });
}
