/**
 * `JournalEntry` — the byte-journal record shape locked by the run/chat
 * orchestration swarm-consensus debate (gap 1, "the observability floor
 * every later increment depends on" — see
 * `ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`'s
 * Final Recommendation). Deliberately a new, minimal vocabulary: no
 * `provenance`/`trust` concept existed anywhere in `@injini/protocol` or
 * `@injini/daemon` before this.
 *
 * `trust` exists for gap 3 (capability-routed transport, not yet built): the
 * debate's Final Recommendation requires "structured/JSON-escaped framing
 * exclusively — never raw string concatenation" when a later increment
 * injects a tool result back into a child agent's input, given the
 * prompt-injection stakes on that exact path. A byte a host itself composed
 * and sent is `'trusted'`; a byte a child agent process produced is
 * `'untrusted'` by definition, since it is attacker-influenceable output the
 * kernel does not control.
 */

/** Where a journaled byte came from and which OS-level stream carried it. */
export type JournalProvenance =
  | { readonly source: 'host'; readonly channel: 'stdin' }
  | { readonly source: 'agent'; readonly channel: 'stdout' | 'stderr' };

export interface JournalEntry {
  /** The raw text, exactly as sent to or received from the child process — pre-parse, pre-translation. */
  readonly content: string;
  readonly provenance: JournalProvenance;
  /** `'trusted'` for host-composed bytes (`provenance.source === 'host'`), `'untrusted'` for agent-produced bytes (`provenance.source === 'agent'`). */
  readonly trust: 'trusted' | 'untrusted';
}
