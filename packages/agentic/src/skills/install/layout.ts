import path from 'node:path';
import type { SkillLayoutPort } from './ports.js';

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
    const normalized = workspaceId.toLowerCase();
    if (normalized.length > 64 || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(normalized)) throw new Error(`resolve: '${workspaceId}' is not a valid workspace id`);
    return { workspaceRoot: path.join(root, workspaceDirectory, normalized), stagingRoot: path.resolve(stagingRoot), stateFileName };
  } });
}
