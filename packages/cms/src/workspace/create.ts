import type { ClockPort, DomainEvent, IdGeneratorPort, OutboxPort, UUID } from "../core/ports.js";

/**
 * @file Workspace creation vertical slice (domain logic).
 *
 * Purpose:
 * Encapsulates business rules for creating a workspace. Also owns the shared
 * `WorkspaceRepoPort` contract and record shape for the whole feature slice
 * (`update.ts`/`delete.ts` import from here rather than duplicating
 * the port) — mirrors `identity/types.ts`+`identity/ports.ts` owning the
 * shared shapes their sibling transition files (`grant-service.ts`) import.
 *
 * How it relates to the package:
 * - Imports abstractions from `../core/ports.js` (no framework/db coupling).
 * - Uses `WorkspaceRepoPort` for persistence and `OutboxPort` for event enqueue.
 * - Is invoked by a host's own admin create-workspace route (moved off the
 *   original unauthenticated `POST /workspaces` route in the host's composition root).
 * - Is verified by tests in `./__tests__`.
 *
 * Architectural role:
 * Demonstrates the intended slice pattern:
 * validate -> check constraints -> persist -> enqueue domain event.
 */
export interface WorkspaceRecord {
  id: UUID;
  name: string;
  slug: string;
  createdAt: string;
}

/**
 * Workspace persistence contract for this slice. `findById`/`list`/`update`/`delete` were
 * later additions (both adapters — this package's `repo.memory.ts` and a host's own SQLite
 * adapter — implement all seven methods; `insert`/`findBySlug`'s existing contract is unchanged).
 */
export interface WorkspaceRepoPort {
  insert(record: WorkspaceRecord): Promise<void>;
  findBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findById(id: UUID): Promise<WorkspaceRecord | null>;
  /** A v1 install always has exactly one row (see `delete.ts`'s header);
   * the port itself is not limited to one. */
  list(): Promise<WorkspaceRecord[]>;
  /** Replaces the full record (id/createdAt immutable by convention — see
   * `update.ts`, which never changes them). */
  update(record: WorkspaceRecord): Promise<void>;
  /** Callers (see `delete.ts`) must apply the last-workspace guard
   * themselves — this port method performs the row deletion only, no business rule. */
  delete(id: UUID): Promise<void>;
}

/**
 * Shared `name`/`slug` validation — used by both `createWorkspace` below
 * and `updateWorkspace` (`update.ts`) so the two transitions can never drift on what counts as a
 * valid name/slug. Returns the normalized (trimmed name, trimmed+lowercased slug) pair; throws
 * `WorkspaceValidationError` on either being invalid.
 *
 * @complexity O(1) — two regex/trim checks.
 * @overallScore 100
 */
export function validateWorkspaceNameAndSlug(input: { name: string; slug: string }): {
  name: string;
  slug: string;
} {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();

  if (!name) throw new WorkspaceValidationError("name is required");
  if (!slug.match(/^[a-z0-9-]+$/)) {
    throw new WorkspaceValidationError("slug must use lowercase letters, numbers, and dashes");
  }

  return { name, slug };
}

/** Command payload for workspace creation. */
export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

/** Dependencies required by the create-workspace slice. */
export interface CreateWorkspaceDeps {
  idGen: IdGeneratorPort;
  clock: ClockPort;
  repo: WorkspaceRepoPort;
  outbox: OutboxPort;
}

/** Required parameters for createWorkspace. */
export interface CreateWorkspaceRequired {
  deps: CreateWorkspaceDeps;
  input: CreateWorkspaceInput;
}

/** Optional parameters for createWorkspace. Reserved for future use. */
export interface CreateWorkspaceOptional {}

/** Thrown when incoming command data is invalid. */
export class WorkspaceValidationError extends Error {}

/** Thrown when uniqueness constraints are violated. */
export class WorkspaceConflictError extends Error {}

/** Thrown when a `:workspaceId` does not resolve to a row. */
export class WorkspaceNotFoundError extends Error {}

/**
 * Thrown when `deleteWorkspace` (`delete.ts`) would remove the install's
 * last remaining workspace row. Named distinctly from `WorkspaceConflictError` (a 409, same as this
 * maps to) so a caller can tell "duplicate slug" apart from "would brick the install" without
 * string-matching the message — mirrors this codebase's `GrantExceedsIssuerError` being kept distinct
 * from `IdentityForbiddenError` for the identical reason (typed-reason clarity).
 */
export class WorkspaceLastRemainingError extends Error {}

/**
 * Execute create-workspace command.
 *
 * Synchronous path:
 * - validate input
 * - check uniqueness
 * - write workspace record
 *
 * Asynchronous path:
 * - enqueue `workspace.created` domain event to outbox
 */
export async function createWorkspace(
  required: CreateWorkspaceRequired,
  _optional: CreateWorkspaceOptional = {}
): Promise<{ id: UUID }> {
  const { deps, input } = required;
  const { name, slug } = validateWorkspaceNameAndSlug(input);

  const existing = await deps.repo.findBySlug(slug);
  if (existing) throw new WorkspaceConflictError(`slug '${slug}' already exists`);

  const now = deps.clock.nowIso();
  const id = deps.idGen.newId();

  await deps.repo.insert({ id, name, slug, createdAt: now });

  const event: DomainEvent<{ workspaceId: UUID; slug: string }> = {
    id: deps.idGen.newId(),
    name: "workspace.created",
    occurredAt: now,
    aggregateId: id,
    workspaceId: id,
    payload: { workspaceId: id, slug },
  };

  await deps.outbox.enqueue(event);
  return { id };
}
