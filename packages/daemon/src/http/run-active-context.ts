/**
 * @file The per-run screen store behind a host daemon's `GET /api/active` — the route `@jini-ai/mcp`'s
 * `get_active_context` tool and its active-resource read call, answered from the screen each live
 * run was started from. The host mounts the route and injects its own page-context type.
 *
 * Run-start screen context is already known; use it instead of requiring a separate client POST
 * to populate the generic active-context pointer.
 *
 * Which run: `GET /api/active` carries no run id, so the route cannot tell which run is asking. It therefore answers only
 * when every live run's screen agrees, and `{active: false}` when two live runs were sent from
 * different screens: an ambiguous answer is reported as none, never as another conversation's
 * screen. The run's own prompt carries its exact screen either way.
 *
 * Age: a recording older than {@link ACTIVE_CONTEXT_TTL_MS} is ignored, matching the 5-minute
 * contract `get_active_context`'s own description states.
 *
 * Trust: every value comes from the browser via the host's page-context reader, already validated and capped.
 */
import { ACTIVE_CONTEXT_TTL_MS } from './active-context.js';

/** The fields of a host's run page context this store reads; the host's richer type passes through. */
export interface RunActiveScreen {
  /** The host route path. */
  readonly path: string;
  readonly entry?: { readonly kind: string; readonly id: string; readonly title: string };
}

/** `GET /api/active`'s body — http-kit's `GetActiveOutput` shape, plus the full `pageContext`. */
export type RunActiveContextAnswer<C extends RunActiveScreen = RunActiveScreen> =
  | { readonly active: false }
  | {
      readonly active: true;
      /** The open entry's id (usable with the content tools), else the host path. */
      readonly resourceRef: string;
      /** The open entry's title, else `null`. */
      readonly resourceName: string | null;
      /** The host route path. */
      readonly detail: string;
      /** When the screen was recorded (run start), epoch ms. */
      readonly ts: number;
      readonly ageMs: number;
      readonly pageContext: C;
    };

/** The live runs' screens: recorded at run start, forgotten at run end. */
export interface RunActiveContextStore<C extends RunActiveScreen = RunActiveScreen> {
  record(required: { runId: string; pageContext: C }, optional?: Record<string, never>): void;
  forget(required: { runId: string }, optional?: Record<string, never>): void;
  read(): RunActiveContextAnswer<C>;
}

interface Recorded<C extends RunActiveScreen> {
  readonly pageContext: C;
  readonly ts: number;
}

/** Two recordings name the same screen when their path and open entry match; a renamed title does not make them differ. */
function screenKey(pageContext: RunActiveScreen): string {
  return JSON.stringify([pageContext.path, pageContext.entry?.kind ?? null, pageContext.entry?.id ?? null]);
}

/** The newest live recording when every live run shows the same screen; undefined when none is
 * live or two live runs disagree. Ties on `ts` go to the later recording in iteration order.
 * @complexity O(live runs). */
function agreedRecording<C extends RunActiveScreen>({ recordings, at }: { recordings: Iterable<Recorded<C>>; at: number }, _options = {}): Recorded<C> | undefined {
  let newest: Recorded<C> | undefined;
  const screens = new Set<string>();
  for (const recorded of recordings) {
    if (at - recorded.ts > ACTIVE_CONTEXT_TTL_MS) continue;
    screens.add(screenKey(recorded.pageContext));
    if (newest === undefined || recorded.ts >= newest.ts) newest = recorded;
  }
  return screens.size === 1 ? newest : undefined;
}

/** The active answer for one agreed recording read at `at`. @complexity O(1). */
function activeAnswer<C extends RunActiveScreen>({ recorded, at }: { recorded: Recorded<C>; at: number }, _options = {}): RunActiveContextAnswer<C> {
  const { pageContext, ts } = recorded;
  return {
    active: true,
    resourceRef: pageContext.entry?.id ?? pageContext.path,
    resourceName: pageContext.entry?.title ?? null,
    detail: pageContext.path,
    ts,
    ageMs: at - ts,
    pageContext,
  };
}

/**
 * Builds the store the daemon records each run's screen in.
 *
 * @param options.now - Clock seam. @default Date.now
 * @returns The store. `read` is O(live runs); entries are removed by `forget`, so size is bounded by
 *   the number of concurrently live runs.
 */
export function createRunActiveContextStore<C extends RunActiveScreen = RunActiveScreen>(options: { readonly now?: () => number } = {}): RunActiveContextStore<C> {
  const now = options.now ?? Date.now;
  const byRunId = new Map<string, Recorded<C>>();

  return {
    record({ runId, pageContext }, _optional = {}) {
      byRunId.set(runId, { pageContext, ts: now() });
    },
    forget({ runId }, _optional = {}) {
      byRunId.delete(runId);
    },
    read() {
      const at = now();
      const newest = agreedRecording({ recordings: byRunId.values(), at });
      return newest ? activeAnswer({ recorded: newest, at }) : { active: false };
    },
  };
}
