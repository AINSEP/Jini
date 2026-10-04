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

/** Minimal listener port; adapters may supply HTTP, HTTPS, or a deterministic socket double. */
export interface ServerListenerPort {
  once(event: 'error' | 'listening', handler: (...args: unknown[]) => void): unknown;
  off(event: 'error' | 'listening', handler: (...args: unknown[]) => void): unknown;
  listen(input: { port: number; host?: string }): unknown;
  address(): { port: number } | string | null;
}

/** Bind the actual listener, retaining it across boot. Only address collisions may try the next
 * port; explicit addresses use the default single attempt. No probe/release/bind race. */
export async function listenServer({ server, port }: { server: ServerListenerPort; port: number },
  { host, attempts = 1 }: { host?: string; attempts?: number } = {}): Promise<number> {
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isInteger(port) || port < 0 || port + attempts - 1 > 65535) {
    throw new RangeError('Invalid listener port or attempt range');
  }
  for (let offset = 0; offset < attempts; offset++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { server.off('error', onError); server.off('listening', onListening); };
        const onError = (error: unknown) => { cleanup(); reject(error); };
        const onListening = () => { cleanup(); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        try { server.listen({ port: port + offset, ...(host === undefined ? {} : { host }) }); }
        catch (error) { onError(error); }
      });
      const address = server.address();
      return typeof address === 'object' && address !== null ? address.port : port + offset;
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'EADDRINUSE' || offset === attempts - 1) throw error;
    }
  }
  throw new Error('Listener range exhausted');
}
