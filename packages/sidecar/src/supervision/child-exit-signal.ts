export interface ChildExitOutcome { code: number | null; signal: NodeJS.Signals | null }
export interface ChildExitSignal {
  onExit(required: { listener: (exit: ChildExitOutcome) => void }, optional?: Record<string, never>): void;
}
export interface ExitSignalChild {
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

/** Capture immediately after spawning, before any await. A child can die between readiness and a
 * supervisor's subscription: forwarding only future events would leave its entry running forever.
 * Late subscriptions replay synchronously, so no instant exists where an exit goes unrecorded.
 * @returns A one-shot object-shaped subscription; listeners are dropped once delivered.
 * @complexity O(1) registration; O(n) delivery to waiting listeners. */
export function createChildExitSignal({ child }: { child: ExitSignalChild }, _optional = {}): ChildExitSignal {
  let exit: ChildExitOutcome | null = null;
  const waiting: Array<(exit: ChildExitOutcome) => void> = [];
  child.once("exit", (code, signal) => {
    exit = { code, signal };
    for (const listener of waiting.splice(0)) listener(exit);
  });
  return {
    onExit({ listener }, _options = {}) {
      if (exit !== null) {
        listener(exit);
        return;
      }
      waiting.push(listener);
    },
  };
}
