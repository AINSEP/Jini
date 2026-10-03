import type { ProcessRequest, ProcessRunnerPort } from '../checks/ports.js';

export interface EnvLoaderPort { load(args: { path: string }): void }
export interface EnvironmentFilesystemPort { exists(args: { path: string }): boolean }
export interface PortListener { pid: string; command: string }

/** Load the required environment-file path, if present. Loader errors propagate to the caller. */
export function loadRepoRootEnvFile({ environmentFile, fs, loader }: {
  environmentFile: string; fs: EnvironmentFilesystemPort; loader: EnvLoaderPort;
}): boolean {
  if (!fs.exists({ path: environmentFile })) return false;
  loader.load({ path: environmentFile });
  return true;
}

/** Parse lsof's field format, dropping incomplete records. Does not spawn a process. */
export function parseLsofListeners({ stdout }: { stdout: string }): PortListener[] {
  const found: PortListener[] = [];
  let pid: string | undefined;
  for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('c') && pid) {
      found.push({ pid, command: line.slice(1) });
      pid = undefined;
    }
  }
  return found;
}

/** Best-effort TCP-listener lookup. The host supplies the platform's listener executable/args. */
export async function listenersOn({ port, runner, listenerCommand }: {
  port: number; runner: ProcessRunnerPort;
  listenerCommand: (args: { port: number }) => ProcessRequest;
}): Promise<PortListener[]> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('port must be an integer from 1 to 65535');
  const request = listenerCommand({ port });
  try {
    const output = await runner.run(request);
    if (output.exitCode !== 0 || !output.stdout) return [];
    return parseLsofListeners({ stdout: output.stdout });
  } catch {
    return [];
  }
}
