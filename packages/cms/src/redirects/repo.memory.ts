/**
 * @file In-memory `RedirectRepoPort` adapter (rule-of-two adapter #1,
 * ADR-006). Test/dev double — no persistence beyond process lifetime.
 *
 * Also satisfies `RedirectDbHandle` (`ports.internal.ts`) directly — `save()`
 * is implemented as the same two-step write (`insertRedirect` then
 * `insertRevision`) that `redirects.ts`/`capture.ts` call independently via
 * `insertRedirectAndRevision`; both paths converge on identical storage
 * semantics without this file importing `ports.internal.ts`'s function value
 * (only its `RedirectDbHandle` type, structurally satisfied here).
 */
import { compareLongestFirst, compareSamePatternExactFirst, compareTieBreak } from "./order.js";
import type { RedirectDbHandle } from "./ports.internal.js";
import type { RedirectRepoPort } from "./ports.js";
import { RedirectNotFoundError } from "./types.js";
import type { ListRedirectsFilter, RedirectRecord, RedirectRevision } from "./types.js";

export class InMemoryRedirectRepo implements RedirectRepoPort, RedirectDbHandle {
  private readonly records = new Map<string, RedirectRecord>();
  private readonly revisionsByRedirectId = new Map<string, RedirectRevision[]>();

  constructor({ seed = [] }: { seed?: RedirectRecord[] } = {}, _optional: Record<string, never> = {}) {
    for (const record of seed) this.records.set(record.id, { ...record });
  }

  private all(workspaceId: string): RedirectRecord[] {
    return [...this.records.values()].filter((r) => r.workspaceId === workspaceId);
  }

  async findById(required: { workspaceId: string; id: string }, _optional: Record<string, never> = {}): Promise<RedirectRecord | null> {
    const record = this.records.get(required.id);
    return record && record.workspaceId === required.workspaceId ? { ...record } : null;
  }

  async lookupExact(required: {
    workspaceId: string;
    path: string;
    includeOverrideOnly: boolean;
  }, _optional: Record<string, never> = {}): Promise<RedirectRecord | null> {
    const candidates = this.all(required.workspaceId).filter(
      (r) =>
        r.status === "active" &&
        r.matchType === "exact" &&
        r.fromPattern === required.path &&
        (!required.includeOverrideOnly || r.override)
    );
    candidates.sort((a, b) => compareTieBreak({ a, b }, {}));
    return candidates[0] ? { ...candidates[0] } : null;
  }

  async lookupLongestPrefix(required: {
    workspaceId: string;
    path: string;
    includeOverrideOnly: boolean;
  }, _optional: Record<string, never> = {}): Promise<RedirectRecord | null> {
    const candidates = this.all(required.workspaceId).filter((r) => {
      if (r.status !== "active" || r.matchType !== "prefix") return false;
      if (required.includeOverrideOnly && !r.override) return false;
      const pattern = r.fromPattern;
      if (required.path === pattern) return true;
      return required.path.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`);
    });
    candidates.sort((a, b) => compareLongestFirst({ a, b }, {}));
    return candidates[0] ? { ...candidates[0] } : null;
  }

  async listDynamic(required: {
    workspaceId: string;
    includeOverrideOnly: boolean;
    limit: number;
  }, _optional: Record<string, never> = {}): Promise<RedirectRecord[]> {
    const candidates = this.all(required.workspaceId).filter(
      (r) => r.status === "active" && r.matchType === "wildcard" && (!required.includeOverrideOnly || r.override)
    );
    candidates.sort((a, b) => compareLongestFirst({ a, b }, {}));
    return candidates.slice(0, required.limit).map((r) => ({ ...r }));
  }

  async list(filter: ListRedirectsFilter, _optional: Record<string, never> = {}): Promise<RedirectRecord[]> {
    return this.all(filter.workspaceId)
      .filter((r) => filter.status === undefined || r.status === filter.status)
      .filter((r) => filter.source === undefined || r.source === filter.source)
      .filter((r) => filter.matchType === undefined || r.matchType === filter.matchType)
      .map((r) => ({ ...r }));
  }

  async findByFromPattern(required: {
    workspaceId: string;
    fromPattern: string;
  }, _optional: Record<string, never> = {}): Promise<RedirectRecord | null> {
    const candidates = this.all(required.workspaceId).filter(
      (r) => r.status === "active" && r.fromPattern === required.fromPattern
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => compareSamePatternExactFirst({ a, b }, {}));
    const winner = candidates[0];
    return winner ? { ...winner } : null;
  }

  async save(required: { record: RedirectRecord; revision: RedirectRevision }, _optional: Record<string, never> = {}): Promise<void> {
    this.insertRedirect(required.record);
    this.insertRevision(required.revision);
  }

  async tombstone(required: {
    workspaceId: string;
    id: string;
    revision: RedirectRevision;
  }, _optional: Record<string, never> = {}): Promise<void> {
    const existing = this.records.get(required.id);
    if (!existing || existing.workspaceId !== required.workspaceId) {
      throw new RedirectNotFoundError(`redirect '${required.id}' was not found`);
    }
    this.insertRedirect(required.revision.state);
    this.insertRevision(required.revision);
  }

  // -------------------------------------------------------------------
  // RedirectDbHandle (used by redirects.ts/capture.ts via ports.internal.ts)
  // -------------------------------------------------------------------

  insertRedirect(record: RedirectRecord, _optional: Record<string, never> = {}): void {
    this.records.set(record.id, { ...record });
  }

  insertRevision(revision: RedirectRevision, _optional: Record<string, never> = {}): void {
    const list = this.revisionsByRedirectId.get(revision.redirectId) ?? [];
    list.push({ ...revision });
    this.revisionsByRedirectId.set(revision.redirectId, list);
  }

  /** Test-only helper: the append-only revision ledger for one redirect, in seq order. */
  listRevisionsForTests({ redirectId }: { redirectId: string }, _optional: Record<string, never> = {}): RedirectRevision[] {
    return [...(this.revisionsByRedirectId.get(redirectId) ?? [])].sort((a, b) => a.seq - b.seq);
  }
}
