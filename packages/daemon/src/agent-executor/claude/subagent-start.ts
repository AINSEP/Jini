import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Replay one prepared run snapshot for each Claude child; never truncate guidance. */
export async function prepareClaudeSubagentStartSettings({ directory, snapshot, settings }: {
  directory: string; snapshot: string; settings?: string;
}, _options = {}): Promise<string> {
  if (Buffer.byteLength(snapshot, 'utf8') > 64 * 1024) throw new Error('Subagent guidance exceeds the 64 KiB snapshot limit.');
  const existing = JSON.parse(settings || '{}') as { hooks?: Record<string, unknown[]> };
  const path = join(directory, 'subagent-start.json');
  await writeFile(path, JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: snapshot },
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  // Base64 carries the path without shell metacharacters on Windows, macOS and Linux.
  const command = `node -e "process.stdout.write(require('node:fs').readFileSync(Buffer.from('${Buffer.from(path).toString('base64')}','base64')))"`;
  const hook = { hooks: [{ type: 'command', command, timeout: 5 }] };
  return JSON.stringify({ ...existing, hooks: { ...existing.hooks,
    SubagentStart: [...(existing.hooks?.SubagentStart ?? []), hook],
  } });
}
