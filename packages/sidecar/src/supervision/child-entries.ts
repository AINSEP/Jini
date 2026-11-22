/**
 * @file The one holder of "which site dirs have a LIVE child server right now" — the host's
 * `openSites` map, grown the one property it never had: it observes the child dying.
 *
 * **The defect this exists for.** `openSites` was a bare `Map`, and the audit's phrasing is
 * exact: it was "a registry of what was STARTED and not yet deliberately stopped", read everywhere
 * as "what is running". the host's server's handle was built for boot-or-fail and discarded the
 * child's exit once ready, so after a crash:
 *
 * - the host snapshot builder (the host lifecycle handler) kept reporting `status: "running"` and the old port;
 * - the host poller's 4 s re-poll — whose own comment claims it is there to catch a crash —
 *   re-read a map that never changed, so the comment was false;
 * - the host open operation (the host) returned `already.server`, so "Start site" handed back the corpse
 *   and spawned nothing. Wedged for the rest of the session.
 *
 * Nothing was wrong with any individual reader. There was simply no component that owned the
 * `running → exited` transition, so every reader of "running" was reading "was started". This is
 * that component.
 *
 * **Deliberately Map-compatible.** `get`/`set`/`has`/`delete`/`values`/`size` behave exactly as the
 * `Map` they replace, so every existing call site and every test that injects a plain `Map` keeps
 * working unchanged. What is added is invisible to those callers: `set` also attaches the exit
 * observation, `delete` also withdraws it, and an exit that arrives while an entry is still current
 * removes it and reports through `onUnexpectedExit`.
 *
 * **Why DELIBERATE closes are not this module's business.** `handleDelete` and the window `closed`
 * listener already drop the entry and the crash-safety row themselves, in that order, for reasons
 * their own comments give. Taking that over would rewrite two working paths to fix a third. This
 * module owns exactly the transition that had no owner: the one nobody asked for.
 *
 * No `electron` import, so all of it is testable under plain `node --test` — same convention as
 * the other host-independent lifecycle modules.
 */

/** How a site's child exited: the `code` and `signal` of Node's own child `exit` event. */
interface ChildExit {
  code: number | null;
  signal: string | null;
}

/** The slice of a the host's server handle this module reads. `onExit` is optional: see `set`. */
interface ObservedServer {
  onExit?: (required: { listener: (exit: ChildExit) => void }, optional?: Record<string, never>) => void;
}

/** The least a stored entry carries. The caller's real entry type (the server handle's `port` and
 *  `pid`, the site's window) passes through as `E`. */
interface ChildEntry {
  server: ObservedServer;
}

/** {@link createChildEntries}'s dependencies. */
interface ChildEntriesRequired<E extends ChildEntry> {
  onUnexpectedExit: (input: { key: string; exit: ChildExit; entry: E }) => void;
}

/** What {@link createChildEntries} returns: `Map<key, E>`'s surface plus {@link lastExitOf}. */
interface ChildEntries<E extends ChildEntry> {
  set(key: string, entry: E): ChildEntries<E>;
  delete(key: string): boolean;
  get(key: string): E | undefined;
  has(key: string): boolean;
  values(): MapIterator<E>;
  readonly size: number;
  lastExitOf({ key }: { key: string }, optional?: Record<string, never>): ChildExit | null;
}

/**
 * @param deps
 * @param deps.onUnexpectedExit called once per site whose child dies without a {@link delete} first.
 *   Receives the entry that was holding it, because the caller needs its `server.pid` to drop the
 *   right crash-safety row — this instance's own registry file can also hold a still-draining earlier
 *   child's row for the same site dir, and closing by site dir alone would take that one too.
 *   Injected rather than reaching for the host registry directly so this module needs no
 *   `registryPath`, no filesystem, and no knowledge of what the caller does about it — the host
 *   drops the crash-safety row and logs; a test just records the call.
 * @returns a `Map`-compatible store with {@link lastExitOf} added.
 * @complexity O(1) to construct.
 */
function createChildEntries<E extends ChildEntry>(deps: ChildEntriesRequired<E>, _optional: Record<string, never> = {}): ChildEntries<E> {
  return new ChildEntriesStore(deps);
}

class ChildEntriesStore<E extends ChildEntry> implements ChildEntries<E> {
  /** Live entries only. */
  private readonly live = new Map<string, E>();
  /** Why the last child died. */
  private readonly exits = new Map<string, ChildExit>();

  constructor(private readonly deps: ChildEntriesRequired<E>) {}

  /**
   * Handle one child's exit.
   *
   * The identity check is the whole correctness of this function. A listener fires against the
   * entry it was attached for, and by the time it fires that entry may already have been deleted
   * (a deliberate stop — whose `server.stop()` is itself what triggered the exit) or REPLACED by a
   * later `set` for the same site dir. Acting on either would drop a healthy entry that has nothing
   * to do with the process that just died. Comparing the entry object identity, not the site dir,
   * is what makes "is this exit still about the thing I am holding" answerable.
   *
   * @complexity O(1).
   */
  private handleExit({ key, entry, exit }: { key: string; entry: E; exit: ChildExit }, _optional: Record<string, never> = {}): void {
    if (this.live.get(key) !== entry) return;
    this.live.delete(key);
    this.exits.set(key, exit);
    this.deps.onUnexpectedExit({ key, exit, entry });
  }

  /**
   * Record a site's live server and begin watching it. `Map.set`'s contract plus the observation.
   *
   * A handle with no `onExit` is stored and simply not watched, rather than throwing: the sites-home
   * and own-server paths both build real handles from the host's server, but tests inject minimal
   * `{server: {port}}` stand-ins, and a store that refused those would force every unrelated test
   * to fake a lifecycle it is not exercising.
   *
   * @complexity O(1).
   */
  set(key: string, entry: E): ChildEntries<E> {
    this.live.set(key, entry);
    // A previous crash at this path is no longer the current answer about it.
    this.exits.delete(key);
    if (typeof entry?.server?.onExit === "function") {
      entry.server.onExit({ listener: (exit) => this.handleExit({ key, entry, exit }) });
    }
    return this;
  }

  /**
   * Forget a site — the deliberate close. Withdraws the exit observation by construction: the
   * listener still fires when `server.stop()` lands, sees this entry is no longer current, and
   * does nothing.
   *
   * @complexity O(1).
   */
  delete(key: string): boolean {
    this.exits.delete(key);
    return this.live.delete(key);
  }

  /** @complexity O(1). */
  get(key: string): E | undefined {
    return this.live.get(key);
  }

  /** @complexity O(1). */
  has(key: string): boolean {
    return this.live.has(key);
  }

  /** @complexity O(1). */
  values(): MapIterator<E> {
    return this.live.values();
  }

  /** @complexity O(1). */
  get size(): number {
    return this.live.size;
  }

  /**
   * How the site at `key` last died, when it died on its own — the fact `SiteRecord`'s
   * `statusDetail` reports so a stopped tab can say "the server exited" rather than presenting a
   * crashed site as one the operator simply never started.
   *
   * Cleared by both {@link set} and {@link delete}: a restarted or forgotten site's old crash is
   * not a current fact about it.
   *
   * @returns `{code, signal}`, or `null` when this site has not died unattended.
   * @complexity O(1).
   */
  lastExitOf({ key }: { key: string }, _optional: Record<string, never> = {}): ChildExit | null {
    return this.exits.get(key) ?? null;
  }
}

export { createChildEntries };
export type { ChildExit, ChildEntry, ChildEntries, ChildEntriesRequired, ObservedServer };
