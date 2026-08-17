/**
 * @file Standalone child-process fixture for `graceful-shutdown.integration.test.ts` — boots a real
 * `createLocalNodeDaemon` daemon and, when `--with-guard` is passed, wires
 * `installGracefulShutdown` to its `stop()` before printing `READY`. The parent test sends this
 * process a genuine OS `SIGTERM`/`SIGINT` and asserts on stdout/exit — the only way to observe
 * whether Node's real default signal-termination behavior applies (no listener: immediate exit, no
 * teardown) versus the library's graceful path (`stop()` — which closes the HTTP listener, disposes
 * every composed feature, and closes the sqlite handles — actually running first) is a real signal
 * delivered to a real, separate process. Simulating it in-process (`process.emit(...)`) — as the
 * sibling unit tests in `host-bootstrap.test.ts` do for `installGracefulShutdown`'s own re-entrancy
 * and timeout logic — never exercises Node's actual OS-level default, so it can't stand in for this
 * fixture's job.
 *
 * Run with `--with-guard` to install {@link installGracefulShutdown} before the daemon starts
 * listening, or `--without-guard` to leave it with no signal handling at all — the negative control
 * proving the daemon really would otherwise die with no graceful teardown on `SIGTERM` (Node's
 * unmodified default needs no listener to terminate), not just asserting an exit code that could
 * pass for an unrelated reason.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalNodeDaemon } from '../../create-local-node-daemon.js';
import { installGracefulShutdown } from '../../host-bootstrap.js';

const mode = process.argv[2];
if (mode !== '--with-guard' && mode !== '--without-guard') {
  throw new Error(`usage: graceful-shutdown-child.ts --with-guard|--without-guard (got ${String(mode)})`);
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jini-graceful-shutdown-child-'));
  const daemon = await createLocalNodeDaemon({ dataDir, discoveryFile: false, packs: [] });

  if (mode === '--with-guard') {
    installGracefulShutdown(daemon.stop, {
      onExit: (code) => {
        // Printed only once `stop()` (or the forced-exit timeout) has actually settled — proof the
        // graceful path ran, not just that the process eventually died.
        // eslint-disable-next-line no-console
        console.log(`STOPPED code=${code} listening=${daemon.server.listening}`);
        process.exit(code);
      },
    });
  }

  // Flush before the parent starts sending signals — `console.log` on a piped stdout can buffer.
  process.stdout.write(`READY ${daemon.url}\n`, () => {});
}

void main().catch((error: unknown) => {
  console.error('graceful-shutdown-child failed to start', error);
  process.exit(1);
});
