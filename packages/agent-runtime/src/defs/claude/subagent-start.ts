import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Give each child a short load instruction; long approved ID lists remain complete on disk. */
export async function prepareClaudeSubagentStartSettings({ directory, context, settings }: {
  directory: string; context: { ids: readonly string[]; instructions: string }; settings?: string;
}, { platform = process.platform }: { platform?: NodeJS.Platform } = {}): Promise<string> {
  const existing = JSON.parse(settings || '{}') as { hooks?: Record<string, unknown[]> };
  const additionalContext = await subagentStartContext({ directory, context });
  const path = join(directory, 'subagent-start.json');
  await writeFile(path, JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext },
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const hook = printFileHook({ path, platform });
  return JSON.stringify({ ...existing, hooks: { ...existing.hooks,
    SubagentStart: [...(existing.hooks?.SubagentStart ?? []), hook],
  } });
}

/** The start context inlines the IDs, or points at a manifest file when inlining would pass 2000 characters. */
async function subagentStartContext({ directory, context }: {
  directory: string; context: { ids: readonly string[]; instructions: string };
}, _optional = {}): Promise<string> {
  const ids = JSON.stringify(context.ids);
  let additionalContext = `Parent plugins: ${ids}.\n${context.instructions}`;
  if (additionalContext.length >= 2000) {
    const manifest = join(directory, 'subagent-plugin-ids.json');
    additionalContext = `Parent plugins: read ${JSON.stringify(manifest)} before continuing. Apply these instructions to every ID in that manifest.\n${context.instructions}`;
    if (additionalContext.length >= 2000) throw new Error('Subagent startup context must be shorter than 2000 characters.');
    await writeFile(manifest, ids, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  return additionalContext;
}

/** A command hook that prints the file at `path`, quoted for this platform's shell. */
function printFileHook({ path, platform }: { path: string; platform: NodeJS.Platform }, _optional = {}) {
  const quoted = platform === 'win32' ? path.replace(/['\u2018-\u201B]/g, '$&$&') : path.replaceAll("'", "'\\''");
  const command = platform === 'win32' ? `Get-Content -Raw -Encoding UTF8 -LiteralPath '${quoted}'` : `cat -- '${quoted}'`;
  return { hooks: [{ type: 'command', command, timeout: 5, ...(platform === 'win32' ? { shell: 'powershell' } : {}) }] };
}
