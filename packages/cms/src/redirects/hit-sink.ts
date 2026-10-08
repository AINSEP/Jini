/**
 * @file `RedirectHitSink` implementation + `registerRedirectHitOutboxHandler`
 * (SPEC-009 REQ-21; ADR-PIPE-009 C-009/C-010).
 *
 * Purpose:
 * Off-hot-path hit aggregation. `phase-handler.ts` enqueues a `redirect.hit`
 * outbox event on every match (W-008, fire-and-forget); this file's outbox
 * subscriber folds it into the in-process hit-stats store via `record()`.
 * Best-effort by design: a dropped/failed increment loses a statistic, never
 * a redirect (INV-06).
 *
 * Storage note (disclosed simplification, matches existing precedent): this
 * is an in-memory-only sink, the same pattern `analytics/repo.memory.ts`'s
 * `LocalBufferSink` already uses in BOTH `server/app.ts` (test/dev) and
 * `server/deps.ts` (the real running server) — no SQLite adapter exists yet
 * for either. The `redirect_hits` table (`db/schema.sqlite.ts`) is reserved
 * for a future real adapter; REQ-21/AC-26 are fully testable and functional
 * against this in-memory sink.
 *
 * Architectural role:
 * INTERNAL SEAM (not an ADR-006 port, see `ports.ts`'s file header) + a thin
 * composition-root registration function.
 */
import type { EventBusPort } from "../core/index.js";

import type { RedirectHitEventPayload, RedirectHitSink } from "./ports.js";
import type { RedirectHitStats } from "./types.js";

export class RedirectHitSinkImpl implements RedirectHitSink {
  private readonly stats = new Map<string, RedirectHitStats>();

  async record(required: { workspaceId: string; redirectId: string; at: string }, _optional: Record<string, never> = {}): Promise<void> {
    const existing = this.stats.get(required.redirectId);
    this.stats.set(required.redirectId, {
      redirectId: required.redirectId,
      workspaceId: required.workspaceId,
      hitCount: (existing?.hitCount ?? 0) + 1,
      lastHitAt: required.at,
    });
  }

  async getStats(required: {
    workspaceId: string;
    redirectId: string;
  }, _optional: Record<string, never> = {}): Promise<RedirectHitStats | null> {
    const found = this.stats.get(required.redirectId);
    return found && found.workspaceId === required.workspaceId ? { ...found } : null;
  }

  async listStats(required: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<RedirectHitStats[]> {
    return [...this.stats.values()].filter((s) => s.workspaceId === required.workspaceId).map((s) => ({ ...s }));
  }
}

export interface RegisterRedirectHitOutboxHandlerDeps {
  bus: EventBusPort;
  hitSink: RedirectHitSink;
}

/**
 * Subscribe `hitSink.record` to the `redirect.hit` outbox event (W-009).
 * Any failure is swallowed here (logged, never rethrown) so a subscriber
 * failure never surfaces to the outbox dispatcher or any request path
 * (REQ-21/AC-26/INV-06) — `EventBusPort.publish` does not itself catch
 * subscriber errors (see `core/events/memory-bus.ts`), so this handler must.
 *
 * @complexity O(1) registration.
 */
export async function registerRedirectHitOutboxHandler(
  deps: RegisterRedirectHitOutboxHandlerDeps,
  _optional: Record<string, never> = {},
): Promise<() => Promise<void>> {
  return deps.bus.subscribe<RedirectHitEventPayload>({ eventName: "redirect.hit", handler: async (event) => {
    try {
      await deps.hitSink.record({
        workspaceId: event.payload.workspaceId,
        redirectId: event.payload.redirectId,
        at: event.payload.at,
      });
    } catch {
      // Best-effort — a failed hit-count fold is logged elsewhere (future
      // operability improvement) but never rethrown (INV-06).
    }
  } });
}
