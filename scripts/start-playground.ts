import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const WEB_URL = 'http://127.0.0.1:4173';
const DAEMON_URL = 'http://127.0.0.1:4317/api/daemon/status';
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const webOnly = process.argv.includes('--web-only');
const children: ChildProcess[] = [];
let closing = false;

function spawnPnpm(args: string[], envOverrides: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(packageManager, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

async function runPnpm(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnPnpm(args);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`));
    });
  });
}

async function waitFor(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still coming up.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function openChrome(): Promise<void> {
  if (process.env.JINI_PLAYGROUND_NO_OPEN === '1') return;
  if (process.platform === 'darwin') {
    const result = spawn('open', ['-a', 'Google Chrome', WEB_URL], { stdio: 'ignore' });
    const code = await new Promise<number | null>((resolveExit) => result.once('exit', resolveExit));
    if (code === 0) return;
    spawn('open', [WEB_URL], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const opener = process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', WEB_URL] : [WEB_URL];
  spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
}

function cleanup(exitCode = 0): void {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 350).unref();
}

async function main(): Promise<void> {
  const grantEnvironment = {
    JINI_PLAYGROUND_GRANT_SECRET: randomBytes(32).toString('base64url'),
  };
  console.log('[Jini Playground] preparing workspace packages…');
  const filters = ['--filter', '@jini-app/reference-web...'];
  if (!webOnly) filters.push('--filter', '@jini-app/reference-desktop...');
  await runPnpm([...filters, '-r', '--if-present', 'run', 'build']);

  console.log('[Jini Playground] starting daemon…');
  const daemon = spawnPnpm(
    ['--filter', '@jini-app/reference-web', 'run', 'daemon'],
    grantEnvironment,
  );
  await waitFor(DAEMON_URL, 'daemon');
  console.log('[Jini Playground] starting renderer…');
  const web = spawnPnpm(['--filter', '@jini-app/reference-web', 'run', 'dev']);
  await waitFor(WEB_URL, 'web renderer');
  await openChrome();

  const watched = [daemon, web];
  if (!webOnly) {
    console.log('[Jini Playground] launching Electron desktop shell…');
    watched.push(spawnPnpm(
      ['--filter', '@jini-app/reference-desktop', 'run', 'dev'],
      grantEnvironment,
    ));
  }
  console.log(`[Jini Playground] ready in Chrome${webOnly ? '' : ' and Electron'} at ${WEB_URL}`);

  await new Promise<void>((resolveDone) => {
    for (const child of watched) child.once('exit', () => resolveDone());
  });
  cleanup();
}

process.once('SIGINT', () => cleanup(0));
process.once('SIGTERM', () => cleanup(0));

void main().catch((error: unknown) => {
  console.error('[Jini Playground] startup failed', error);
  cleanup(1);
});
