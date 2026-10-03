// Child fixture for the copied cross-process protocol tests. Pauses through the filesystem port.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAgentPluginLifecycle } from '../../index.js';
import { ports } from '../test-support.js';

const [, , mode, rootArg, signalArg, pluginArg, countArg] = process.argv;
if (!mode || !rootArg || !signalArg || !pluginArg) throw new Error('Missing activation writer arguments');
const workspaceRoot = rootArg;
const signalDir = signalArg;
const pluginId = pluginArg;
function signalPath(name: string): string { return path.join(signalDir, name); }
async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try { await fs.readFile(filePath); return; }
    catch { if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${filePath}`); await sleep(10); }
  }
}
const filesystem = { ...fs, rename: (async (...args: Parameters<typeof fs.rename>) => {
  if (mode === 'pause-before-rename' && path.basename(String(args[1])) === 'activations.json') {
    await fs.writeFile(signalPath(`${pluginId}.paused`), '1');
    await waitForFile(signalPath(`${pluginId}.release`), 30_000);
  }
  await fs.rename(...args);
}) as typeof fs.rename };
const { setAgentPluginActivation } = createAgentPluginLifecycle({ ...ports, filesystem });
async function main(): Promise<void> {
  await fs.mkdir(signalDir, { recursive: true });
  if (mode === 'burst') {
    await fs.writeFile(signalPath(`${pluginId}.ready`), '1');
    await waitForFile(signalPath('go'), 30_000);
    for (let index = 0; index < Number(countArg ?? '0'); index++) {
      await setAgentPluginActivation({ workspaceRoot, pluginId: `${pluginId}-${index}`, enabled: false, actor: 'child' });
    }
    return;
  }
  await fs.writeFile(signalPath(`${pluginId}.started`), '1');
  await setAgentPluginActivation({ workspaceRoot, pluginId, enabled: false, actor: 'child' });
}
main().catch(error => { console.error(error); process.exit(1); });
