import { constants, promises as fs } from 'node:fs';
import { withFileLock, writeFileAtomicAsync } from '@jini-ai/platform/fs';
import { isRecord } from './values.js';

/** Read the current settings text; a missing file is undefined, every other failure rejects. */
async function readSettingsText(settingsPath: string): Promise<string | undefined> {
  try { return await fs.readFile(settingsPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

/** Parse and validate the settings shape; anything unexpected rejects rather than widening permissions. */
function parseSettings(raw: string | undefined): { settings: Record<string, unknown>; permissions: Record<string, unknown>; allow: unknown[] } {
  const settings: unknown = raw === undefined ? {} : JSON.parse(raw);
  if (!isRecord(settings)) throw new Error('Antigravity settings must be an object');
  const permissions = settings.permissions === undefined ? {} : settings.permissions;
  if (!isRecord(permissions) || (permissions.allow !== undefined && !Array.isArray(permissions.allow))) {
    throw new Error('Antigravity permissions.allow must be an array');
  }
  return { settings, permissions, allow: permissions.allow ?? [] };
}

/** The allow list holding exactly one copy of rule (first occurrence kept, order otherwise
 * unchanged), or null when it already holds exactly one and nothing needs writing. */
function grantedAllowList(allow: readonly unknown[], rule: string): unknown[] | null {
  const first = allow.indexOf(rule);
  if (first < 0) return [...allow, rule];
  const deduped = allow.filter((entry, index) => entry !== rule || index === first);
  return deduped.length === allow.length ? null : deduped;
}

async function backupOriginalOnce(settingsPath: string): Promise<void> {
  // Never replace the first backup, including on subsequent launches after operator edits.
  await fs.copyFile(settingsPath, `${settingsPath}.jini-backup`, constants.COPYFILE_EXCL)
    .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
}

/**
 * Persist one server's MCP grant for agy, which has no run-scoped settings override.
 * Reuses the platform lock and atomic writer; keeps the first existing file as a backup.
 * Invalid settings and I/O failures reject before spawn rather than widening permissions.
 * @complexity O(settings bytes), including the allow-list scan; bounded by the settings file.
 */
export async function ensureAntigravityMcpPermission(
  { settingsPath, serverName }: { settingsPath: string; serverName: string },
  _options: Record<string, never> = {},
): Promise<void> {
  if (!/^[\w.-]+$/.test(serverName)) throw new Error('Invalid MCP server name');
  const rule = `mcp(${serverName}/*)`;
  await withFileLock({ lockPath: `${settingsPath}.jini-lock`, run: async () => {
    const raw = await readSettingsText(settingsPath);
    const { settings, permissions, allow } = parseSettings(raw);
    const nextAllow = grantedAllowList(allow, rule);
    if (nextAllow === null) return;
    if (raw !== undefined) await backupOriginalOnce(settingsPath);
    await writeFileAtomicAsync({ filePath: settingsPath, content: `${JSON.stringify({
      ...settings, permissions: { ...permissions, allow: nextAllow },
    }, null, 2)}\n` }, { refuseSymlink: true });
  } }, { createParent: true, timeoutMs: 5000 });
}
