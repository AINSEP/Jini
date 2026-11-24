/**
 * Self-termination watchdog, symmetric to `agent-daemon-server.ts`'s own `startParentWatchdog()`
 * one level up (`ADS-memory/reports/analysis/2026-08-05-symmetric-watchdog.md` has the full
 * measurement trail this comment summarizes).
 *
 * That daemon watchdog closes "the daemon becomes an orphan when THIS process dies without
 * running `reap()`". This is the other half: THIS process becomes the orphan when whatever was
 * supposed to be driving it dies without ever sending it a catchable signal — measured three times
 * independently for one concrete trigger (an external kill of Playwright's own top-level CLI
 * process bypasses its `teardown()`/`gracefulShutdown` entirely; see the root-cause doc's Round
 * 2/4) and confirmed live for every agent that kills its own runs, which this repo's own traps say
 * is routine, not a corner case.
 *
 * Two independent checks, because measurement showed one pid source does not cover every real
 * launch context:
 *
 * 1. **`process.ppid` liveness (always on, no env var).** Node does not cache `process.ppid` at
 *    startup — it re-reads the OS's current parent pid on every access, and flips the moment this
 *    process is reparented (POSIX: to pid 1 on macOS/most Linux; to the nearest registered
 *    subreaper where one exists — comparing against the value recorded at boot, rather than
 *    testing `=== 1`, is what makes this correct in both cases without needing to know which one
 *    applies). Verified directly, twice: a child spawned the same way Playwright spawns its
 *    `webServer` (`shell: true`, per `playwright/lib/runner/index.js:841`) logged its own
 *    `process.ppid` flipping from the real parent's pid to the reparent target within ~300ms of
 *    the parent dying — once via a plain `process.exit()`, once via an actual external `kill -9`
 *    on the parent (the literal shape of the still-open gap). No ambiguous-error case exists here
 *    the way `EPERM` vs `ESRCH` is ambiguous for `kill(pid, 0)` below: reading `process.ppid` never
 *    fails or needs a permission check, and reparenting is never transient (the original parent
 *    cannot come back to life under the same pid), so there is no false-positive path — every
 *    observed change is a real, permanent parent death. It also has no PID-reuse blind spot the
 *    way `kill(pid, 0)` does: this never probes an external pid's continued existence at all, it
 *    only compares the kernel's own live record of THIS process's parent against what was recorded
 *    at boot, so a coincidental pid reuse elsewhere cannot spoof it either direction.
 *
 *    Measured, this check's DIRECT OS parent is the real driving process in three of the four
 *    launch contexts investigated: Playwright's `webServer` (confirmed via `ps` — `shell: true`
 *    plus a single trailing simple command makes the shell exec-replace itself into `node`, so
 *    this process's ppid IS Playwright's own top-level CLI process directly, no intermediate `sh`
 *    hop); a bare/manual `node --import tsx src/index.ts` from an interactive shell (same one-hop
 *    shape — the shell IS the parent); and CI, where this repository's own `.github/workflows/
 *    ci.yml` never boots this file at all today (`npm test` is the plain unit-test runner, no
 *    Playwright/e2e step exists in CI), so there is nothing to verify there yet, not merely
 *    something unverified.
 *
 * 2. **The host's dev-supervisor pid variable (`envNames.devSupervisorPid`; opt-in, mirrors the daemon's own parent-pid variable exactly).**
 *    The one launch context measured to need it: `npm run dev`'s `tsx watch`. Confirmed via `ps`
 *    that `npx`/`tsx watch` are themselves Node-based CLI wrappers that do NOT exec-replace, so
 *    this process's real OS ppid there is the `tsx watch` supervisor two hops below `dev.mjs`, not
 *    `dev.mjs` itself — and that supervisor does not die just because `dev.mjs` does. Reproduced
 *    the resulting gap directly, isolated: booted the real `dev.mjs` tree, `kill -9`'d only
 *    `dev.mjs`'s own pid, and the API and daemon were both still alive and bound, unchanged, 2s
 *    later — the exact same shape as the Playwright gap, one supervisor layer up. `dev.mjs` now
 *    sets this var to its own pid for exactly this check; same `ESRCH`-confirms-death,
 *    everything-else-is-inconclusive logic as the daemon's own watchdog, including its accepted
 *    PID-reuse limitation — not closed here for the same reason it was not closed there: no
 *    portable, cheap Node API exists to read an arbitrary pid's start time, for a benefit that is
 *    marginal given the short poll window and low pid churn on a single dev machine.
 *
 * `<envNames.disable>=1` is an escape hatch for a launch shape neither this file nor the
 * analysis doc enumerated: intentional daemonization (e.g. `nohup ... &` followed by logout, or any
 * double-fork pattern) deliberately arranges for this process to outlive the parent that started
 * it — that is that operator's explicit intent, not an orphan to clean up, and check #1 above
 * cannot tell the two apart on its own. Checked this repo for an existing such launch path before
 * relying on that distinction mattering here: no Dockerfile, docker-compose, systemd `.service`,
 * launchd `.plist`, Procfile, or deploy script exists in this repository, and nothing greps for
 * `nohup`/`daemonize`/`setsid` applied TO this file (only this file and `dev.mjs` daemonizing their
 * OWN children, which is a different relationship). Production boots via `npm start` -> bare `node
 * dist/src/index.js`, no wrapper. That rules out what is committed here; it says nothing about how
 * an operator might run this on a bare VM outside this repo, which is exactly why the escape hatch
 * exists unconditionally rather than being gated on what this search did or didn't find.
 *
 * Does not fight `tsx watch`'s own restart-on-save cycle: that delivers a real, catchable signal to
 * the OLD process first (already handled by the `SIGINT`/`SIGTERM`/`SIGHUP` handlers
 * `startAssistantDaemon` registers — see `daemon-supervisor.ts`), and each fresh incarnation of
 * this file gets its own fresh `bootPpid`/interval at module load — no state carries over from the
 * process being replaced.
 *
 * Windows: not verified. Playwright's own `attemptToGracefullyClose()` throws unconditionally on
 * `win32` for this exact family of behavior (root-cause doc, quoting `playwright/lib/runner/
 * index.js`) — this inherits that same "not supported" posture rather than assuming parity.
 *
 * `process.exit()` from inside this function's interval callback fires the existing
 * `process.on("exit", ...)` listener `startAssistantDaemon` registers (a standard Node guarantee
 * already relied on by this file's own SIGINT/SIGTERM/SIGHUP handlers), so a self-exit here cleans
 * up the agent daemon exactly like every other termination path already does — no separate call
 * needed here.
 */
/**
 * The process-level effects the watchdog needs, injected so every branch is testable with fakes;
 * {@link startOwnParentWatchdog}'s callers wire the live `process`/`console`/`setInterval` at the
 * composition edge (the host's entry module).
 */
export interface ParentWatchdogPorts {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The host's env variable names: `disable` (set to `"1"` to opt out) and `devSupervisorPid`. */
  readonly envNames: { readonly disable: string; readonly devSupervisorPid: string };
  /** Prefix for every log/error line, e.g. `"[index]"` — the host names its own entry. */
  readonly logTag: string;
  /** Read on every poll: the live parent pid (Node updates `process.ppid` after a reparent). */
  readonly ppid: () => number;
  /** `process.kill(pid, 0)` — throws an `ErrnoException` when the pid cannot be signalled. */
  readonly signalZero: (pid: number) => void;
  readonly exit: (code: number) => void;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly setInterval: (callback: () => void, ms: number) => unknown;
}

const POLL_INTERVAL_MS = 3_000;

function errnoCode({ error }: { error: unknown }, _optional = {}): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

  // Confirms the recorded parent was actually alive at the instant we captured it — closes a real
  // race, found by probe rather than reasoned about: `node --import tsx` takes several real
  // seconds to finish transforming/loading this module before ANY of this file's own code runs
  // (measured live: ~4-8s), and no JS on earth can run earlier than that. If the real parent dies
  // during that window, `process.ppid` already reads the reparent target by the time this line
  // executes, and adopting THAT as the "normal" baseline would mean the comparison below can never
  // fire again — silently defeating the whole watchdog for exactly the boot-time version of the
  // failure it exists to catch. Same ESRCH-confirms-death, everything-else-is-inconclusive logic as
  // every other check in this family: only a confirmed absence is treated as death.
function parentGoneAtBoot({ ports, bootPpid }: { ports: ParentWatchdogPorts; bootPpid: number }): boolean {
  try {
    ports.signalZero(bootPpid);
  } catch (error) {
    if (errnoCode({ error }) === "ESRCH") {
      ports.error(`${ports.logTag} parent process ${bootPpid} was already gone before this process finished booting — self-terminating`);
      ports.exit(1);
      return true;
    }
  }
  return false;
}

/** The dev-supervisor pid variable as a positive integer pid, or `undefined` (reporting an invalid value). */
function resolveDevSupervisorPid(ports: ParentWatchdogPorts): number | undefined {
  const rawSupervisorPid = ports.env[ports.envNames.devSupervisorPid];
  if (rawSupervisorPid === undefined) return undefined;
  const parsed = Number(rawSupervisorPid);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  ports.error(`${ports.logTag} ${ports.envNames.devSupervisorPid}="${rawSupervisorPid}" is not a valid pid — that check is disabled`);
  return undefined;
}

/** One supervisor liveness check: exits only on a confirmed (`ESRCH`) absence. */
function checkDevSupervisor({ ports, devSupervisorPid }: { ports: ParentWatchdogPorts; devSupervisorPid: number }): void {
  try {
        // See this function's own doc: signal 0 has no side effect, it only answers "does this pid
        // still exist".
    ports.signalZero(devSupervisorPid);
  } catch (error) {
    if (errnoCode({ error }) !== "ESRCH") {
          // Anything other than "no such process" (e.g. a transient EPERM) is inconclusive, not a
          // confirmed death — skip this poll rather than risk a false-positive self-kill on a
          // supervisor that is actually still alive. Mirrors the daemon watchdog's own logic.
      return;
    }
    ports.error(`${ports.logTag} dev supervisor process ${devSupervisorPid} is gone — self-terminating`);
    ports.exit(1);
  }
}

/** One poll: a reparent or a confirmed-dead dev supervisor self-terminates this process. */
function pollParents({ ports, bootPpid, devSupervisorPid }: { ports: ParentWatchdogPorts; bootPpid: number; devSupervisorPid: number | undefined }): void {
  const currentPpid = ports.ppid();
  if (currentPpid !== bootPpid) {
    ports.error(`${ports.logTag} parent process ${bootPpid} is gone (reparented to ${currentPpid}) — self-terminating`);
    ports.exit(1);
    return;
  }
  if (devSupervisorPid !== undefined) checkDevSupervisor({ ports, devSupervisorPid });
}

/**
 * Arms the parent watchdog described in this file's header.
 * @complexity O(1) per poll.
 */
export function startOwnParentWatchdog(ports: ParentWatchdogPorts, _options: Record<string, never> = {}): void {
  if (ports.env[ports.envNames.disable] === "1") {
    ports.log(`${ports.logTag} ${ports.envNames.disable}=1 — parent watchdog disabled`);
    return;
  }

  const bootPpid = ports.ppid();
  if (parentGoneAtBoot({ ports, bootPpid })) return;
  const devSupervisorPid = resolveDevSupervisorPid(ports);

  // Same 3s interval as the daemon's own watchdog, same rationale: fast enough that a leaked
  // process closes long before it could collide with a later boot attempt, slow enough to cost
  // nothing meaningful against a process spending most of its time idle between real requests.
  // Not `.unref()`'d, for the same reason as the daemon's own timer: this interval's entire job is
  // to keep watching for as long as its parent is, and letting it fall out of the event loop early
  // would undermine that.
  ports.setInterval(() => pollParents({ ports, bootPpid, devSupervisorPid }), POLL_INTERVAL_MS);
}
