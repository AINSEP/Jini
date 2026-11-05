import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { backupOriginalOnce, withFileLock, writeFileAtomicAsync } from '@jini-ai/platform/fs';
import { applyJsonInstall, isAgentSlug, planAgentInstall, type McpLaunchSpec, type PlanContext } from './install.js';

/** Missing is the only condition permitting creation; reject symlinks even for an unchanged entry. */
async function readConfig({ path }: { path: string }): Promise<string | null> {
  try {
    if ((await fs.lstat(path)).isSymbolicLink()) throw new Error('MCP config is a symlink; choose another agent.');
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

/** Persistent connectors contain no run credentials. Only the static Electron switch is permitted. */
function assertCredentialFree({ spec }: { spec: McpLaunchSpec }): void {
  if (Object.entries(spec.env).some(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' || value !== '1')) {
    throw new Error('MCP connector contains run environment values and cannot be saved.');
  }
}

/** Install one owned static connector after explicit consent, preserving foreign data and a first backup.
 * The host must call this only for a CLI without a temporary config path. No token is accepted or minted.
 * @complexity O(config bytes) time and space; one locked read and, when changed, backup plus atomic write.
 */
export async function installOwnedJsonAgent(
  required: { agentId: string; spec: McpLaunchSpec; ctx: PlanContext; allowed: boolean },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (required.allowed !== true) throw new Error('Allow this agent to change its settings outside the host before installing its connector.');
  assertCredentialFree(required);
  const slug = { value: required.agentId };
  if (!isAgentSlug(slug)) throw new Error('Unknown MCP agent installation');
  const plan = planAgentInstall({ slug: slug.value, spec: required.spec, ctx: required.ctx });
  if (plan.kind !== 'json') throw new Error('MCP installation does not use a JSON registry');
  await withFileLock({ lockPath: `${plan.configPath}.jini-lock`, run: async () => {
    const existingText = await readConfig({ path: plan.configPath });
    const content = applyJsonInstall({ existingText, plan });
    if (existingText !== null && isDeepStrictEqual(JSON.parse(existingText), JSON.parse(content))) return;
    if (existingText !== null) await backupOriginalOnce({ filePath: plan.configPath });
    await writeFileAtomicAsync({ filePath: plan.configPath, content }, { refuseSymlink: true });
  } }, { createParent: true, timeoutMs: 5000 });
}
