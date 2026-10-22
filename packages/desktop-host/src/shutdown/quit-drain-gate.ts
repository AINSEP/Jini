/** Tracks unfinished work and gates graceful shutdown without depending on a desktop backend. */
/**
 * A repeated quit during the drain must be prevented and dropped. Letting a second attempt
 * through before asynchronous shutdown finishes can orphan detached child processes.
 * Hold even if nothingToDrain has become true: resource registries can empty as children exit
 * while other teardown work is still pending. The drain's own final quit proceeds only after
 * the phase becomes drained; the host supplies a force-exit deadline for a hung drain.
 */
type QuitPhase = "idle" | "draining" | "drained";

type BeforeQuitAction = "proceed" | "drain" | "hold";

interface BeforeQuitInput {
  phase: QuitPhase;
  nothingToDrain: boolean;
}

/** Decide whether to proceed, drain or hold; an in-progress drain always holds repeated quit attempts. Throws for an unknown phase. @complexity O(1). */
function decideBeforeQuit(input: BeforeQuitInput): BeforeQuitAction {
  switch (input.phase) {
    case "idle":
      return input.nothingToDrain ? "proceed" : "drain";
    case "draining":
      return "hold";
    case "drained":
      return "proceed";
    default:
      throw new TypeError(`decideBeforeQuit: unknown quit phase ${JSON.stringify(input.phase)}`);
  }
}

export { decideBeforeQuit };
export type { BeforeQuitAction, BeforeQuitInput, QuitPhase };
