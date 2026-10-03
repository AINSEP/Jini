/** Tracks unfinished work and gates graceful shutdown without depending on a desktop backend. */
/**
 * Chromium's POSIX quit handler is one-shot: it resets the signal to its default disposition,
 * so a second copy can kill the process during the first copy's graceful drain. Launchers can
 * deliver duplicates through process-group signaling and forwarding by wrapper processes.
 * Persistent listeners absorb those copies; request quit only once to avoid re-entering shutdown.
 * Register after app readiness because Chromium installs its handler after module loading and
 * can replace listeners installed earlier. Absorbing repeats also removes their accidental escape
 * hatch for a hung drain, so the first signal must arm a bounded force-exit deadline.
 */
const QUIT_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

type QuitTimer = (args: { fn: () => void; ms: number }) => { unref?: () => void };

interface QuitSignalInput {
  processLike: { on(args: { signal: NodeJS.Signals; listener: () => void }): unknown };
  quit: () => void;
  forceExit: () => void;
  deadlineMs: number;
}

interface QuitSignalOptions {
  setTimer?: QuitTimer;
}

/** Register persistent signal listeners. The first signal arms an unreferenced force-exit deadline and requests graceful quit exactly once. Register after the host is ready. @complexity O(1). */
function routeQuitSignals(input: QuitSignalInput, options: QuitSignalOptions = {}): void {
  const setTimer: QuitTimer = options.setTimer ?? (({ fn, ms }) => setTimeout(fn, ms));
  let requested = false;

  const onSignal = () => {
    if (requested) return;
    requested = true;
    setTimer({ fn: input.forceExit, ms: input.deadlineMs }).unref?.();
    input.quit();
  };

  for (const signal of QUIT_SIGNALS) input.processLike.on({ signal, listener: onSignal });
}

export { routeQuitSignals, QUIT_SIGNALS };
export type { QuitSignalInput, QuitSignalOptions, QuitTimer };
