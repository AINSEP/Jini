import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Give each child a short load instruction; long approved ID lists remain complete on disk. */
export async function prepareClaudeSubagentStartSettings({ directory, context, settings }: {
  directory: string; context: { ids: readonly string[]; instructions: string }; settings?: string;
}, { platform = process.platform }: { platform?: NodeJS.Platform } = {}): Promise<string> {
  const existing = JSON.parse(settings || '{}') as { hooks?: Record<string, unknown[]> };
  const ids = JSON.stringify(context.ids);
  let additionalContext = `Parent plugins: ${ids}.\n${context.instructions}`;
  if (additionalContext.length >= 2000) {
    const manifest = join(directory, 'subagent-plugin-ids.json');
    additionalContext = `Parent plugins: read ${JSON.stringify(manifest)} before continuing. Apply these instructions to every ID in that manifest.\n${context.instructions}`;
    if (additionalContext.length >= 2000) throw new Error('Subagent startup context must be shorter than 2000 characters.');
    await writeFile(manifest, ids, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  const path = join(directory, 'subagent-start.json');
  await writeFile(path, JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext },
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const quoted = platform === 'win32' ? path.replace(/['\u2018-\u201B]/g, '$&$&') : path.replaceAll("'", "'\\''");
  const command = platform === 'win32' ? `Get-Content -Raw -Encoding UTF8 -LiteralPath '${quoted}'` : `cat -- '${quoted}'`;
  const hook = { hooks: [{ type: 'command', command, timeout: 5, ...(platform === 'win32' ? { shell: 'powershell' } : {}) }] };
  return JSON.stringify({ ...existing, hooks: { ...existing.hooks,
    SubagentStart: [...(existing.hooks?.SubagentStart ?? []), hook],
  } });
}
