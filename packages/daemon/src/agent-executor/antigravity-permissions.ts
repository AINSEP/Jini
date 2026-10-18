import { constants, promises as fs } from 'node:fs';
import { withFileLock, writeFileAtomicAsync } from '@jini-ai/platform/fs';
import { isRecord } from './values.js';

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
    let raw: string | undefined;
    try { raw = await fs.readFile(settingsPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const settings: unknown = raw === undefined ? {} : JSON.parse(raw);
    if (!isRecord(settings)) throw new Error('Antigravity settings must be an object');
    const permissions = settings.permissions === undefined ? {} : settings.permissions;
    if (!isRecord(permissions) || (permissions.allow !== undefined && !Array.isArray(permissions.allow))) {
      throw new Error('Antigravity permissions.allow must be an array');
    }
    const allow: unknown[] = permissions.allow ?? [];
    const first = allow.indexOf(rule);
    const nextAllow = first < 0 ? [...allow, rule] : allow.filter((entry, index) => entry !== rule || index === first);
    if (first >= 0 && nextAllow.length === allow.length) return;
    if (raw !== undefined) {
      // Never replace the first backup, including on subsequent launches after operator edits.
      await fs.copyFile(settingsPath, `${settingsPath}.jini-backup`, constants.COPYFILE_EXCL)
        .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    }
    await writeFileAtomicAsync({ filePath: settingsPath, content: `${JSON.stringify({
      ...settings, permissions: { ...permissions, allow: nextAllow },
    }, null, 2)}\n` }, { refuseSymlink: true });
  } }, { createParent: true, timeoutMs: 5000 });
}
