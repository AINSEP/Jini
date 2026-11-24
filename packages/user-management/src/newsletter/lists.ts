/**
 * @file `lists.ts` — list CRUD + default-list protection chokepoint (ADR-PIPE-011 C-012, REQ-08/09).
 *
 * Small, independent chokepoint (lists have no status machine) — `saveList`/`archiveList` are the
 * ONLY writers of `p_newsletter__lists`.
 */
import type { UUID } from "@jini-ai/core/primitives";
import {
  NewsletterConflictError,
  NewsletterDefaultListProtectedError,
  NewsletterListNotFoundError,
  NewsletterValidationError,
} from "./errors.js";
import type { NewsletterListRepoPort } from "./ports.js";
import type { NewsletterListRow } from "./types.js";

export interface ListsDeps {
  listRepo: NewsletterListRepoPort;
  clock: { nowIso(): string };
  ids: { newId(): string };
}

/**
 * Admin-created lists always land `isDefault: false` (behavior.spec.md §3) — only seed-time list
 * creation may set `isDefault: true`. Enforces slug uniqueness per workspace (api.spec.md §6:
 * `CREATE_LIST` -> `409 NEWSLETTER_CONFLICT`) — this port has no dedicated `findBySlug`, so the
 * check scans the (small, per-workspace) `list()` result rather than adding a new port method
 * across both adapters for this one guard.
 */
export async function saveList(required: {
  deps: ListsDeps;
  input: { workspaceId: UUID; id?: UUID; name: string; slug: string };
}, _optional: Record<string, never> = {}): Promise<{ list: NewsletterListRow }> {
  const { deps, input } = required;
  if (input.name.trim().length === 0) {
    throw new NewsletterValidationError({ message: "name must not be empty", field: "name", reason: "required" });
  }
  if (input.slug.trim().length === 0) {
    throw new NewsletterValidationError({ message: "slug must not be empty", field: "slug", reason: "required" });
  }

  const siblingLists = await deps.listRepo.list({ workspaceId: input.workspaceId });
  const slugCollision = siblingLists.find((l) => l.slug === input.slug && l.id !== input.id);
  if (slugCollision) {
    // Lists carry no optimistic-concurrency version (unlike campaigns) — `expectedVersion`/
    // `actualVersion` are not meaningful here; `0`/`0` are inert placeholders, not a real version pair.
    throw new NewsletterConflictError({ message: `a list with slug '${input.slug}' already exists`, entity: "list", id: slugCollision.id, expectedVersion: 0, actualVersion: 0 });
  }

  const now = deps.clock.nowIso();
  if (input.id) {
    const existing = await deps.listRepo.findById({ workspaceId: input.workspaceId, id: input.id });
    if (!existing) throw new NewsletterListNotFoundError(`list ${input.id} was not found`);
    const list: NewsletterListRow = { ...existing, name: input.name, slug: input.slug, updatedAt: now };
    await deps.listRepo.save(list);
    return { list };
  }

  const list: NewsletterListRow = {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    name: input.name,
    slug: input.slug,
    isDefault: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await deps.listRepo.save(list);
  return { list };
}

/** REQ-09: the default list can never be archived (`NEWSLETTER_DEFAULT_LIST_PROTECTED`). */
export async function archiveList(required: {
  deps: ListsDeps;
  input: { workspaceId: UUID; id: UUID };
}, _optional: Record<string, never> = {}): Promise<{ list: NewsletterListRow }> {
  const { deps, input } = required;
  const existing = await deps.listRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new NewsletterListNotFoundError(`list ${input.id} was not found`);
  if (existing.isDefault) {
    throw new NewsletterDefaultListProtectedError({ message: `the default list cannot be archived`, listId: existing.id });
  }
  const list: NewsletterListRow = { ...existing, status: "archived", updatedAt: deps.clock.nowIso() };
  await deps.listRepo.save(list);
  return { list };
}

/**
 * Seed the workspace's default "all subscribers" list, exactly once (REQ-08). Idempotent — a
 * repeated call for a workspace that already has a default list is a no-op (matches
 * `declareDataModule()`'s own skip-if-exists convention). Called from `server/seed.ts` (T030).
 */
export async function ensureDefaultList(required: {
  deps: ListsDeps;
  input: { workspaceId: UUID };
}, _optional: Record<string, never> = {}): Promise<{ list: NewsletterListRow }> {
  const { deps, input } = required;
  const existing = await deps.listRepo.findDefault({ workspaceId: input.workspaceId });
  if (existing) return { list: existing };

  const now = deps.clock.nowIso();
  const list: NewsletterListRow = {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    name: "All subscribers",
    slug: "all-subscribers",
    isDefault: true,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await deps.listRepo.save(list);
  return { list };
}
