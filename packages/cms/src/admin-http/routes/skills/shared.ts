import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards and error mapping for the `skills` admin route specs.
 *
 * Every skills route is gated by the assistant permission (skills are assistant tools): one
 * id-free check, then the work. The management routes shared one `catch`: a skill input error is
 * the flat validation 400, anything else the host's redacted 500. The files route never mapped
 * input errors, so it does not use {@link rejectSkillInputError}.
 */

/** The principal fields these routes read: only the id, as the guidance preview's caller. */
export interface SkillRoutePrincipal { id: string }

/** One installed skill as discovery reports it: its tool id and, when it has one, its own folder. */
export interface SkillToolSourceRef { readonly id: string; readonly directory?: string }

/**
 * The installed skills of the served workspace. Injected: discovery reads the host's skill layout
 * on disk. `includeDisabled` is passed only when a route asks for it, so an omitted flag keeps the
 * discovery default (enabled skills only).
 */
export type SkillToolSourcesLoadFn = (required: { includeDisabled?: boolean }) => Promise<readonly SkillToolSourceRef[]>;

/**
 * Whether a thrown error is the host's skill input error (a caller mistake: bad source, unknown
 * skill, invalid package). Injected because the error class belongs to the host's install service.
 */
export type SkillInputErrorTest = (required: { err: unknown }, optional?: Record<string, never>) => boolean;

/**
 * Asks the host for the assistant permission on the `skill` entity type, with no entity id: every
 * skills route acts on the workspace's skill set, and the hand-written routes never named one.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeSkills({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("skills admin route has no authorizer");
  await authorize({ permission: "admin.assistant.use", entityType: "skill" });
}

/**
 * The `:toolId` path segment as the hand-written routes read it (`String(...)`, no `?? ""`):
 * Express always fills it, and installed ids always carry the `skill_` prefix, so a missing
 * segment's `"undefined"` can never select a skill. @complexity O(1).
 */
export function skillToolIdParam(params: Record<string, string | undefined>, _optional: Record<string, never> = {}): string {
  return String(params.toolId);
}

/** The flat validation 400 every management route answers for a caller mistake. @complexity O(1). */
export function rejectSkillInput({ message }: { message: string }, _optional: Record<string, never> = {}): never {
  rejectRoute({ status: 400, error: message, code: "VALIDATION_ERROR" });
}

/** The skills 404: an unknown id and a disabled skill read the same, so ids are not probed. @complexity O(1). */
export function rejectSkillNotFound(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): never {
  rejectRoute({ status: 404, error: "Skill was not found or is disabled.", code: "NOT_FOUND" });
}

/**
 * The management routes' shared `catch`: the host's skill input error becomes the validation 400
 * with its own message; anything else (including a refusal already thrown) is rethrown unchanged so
 * the host's error port answers it. @complexity O(1) plus the injected test.
 */
export function rejectSkillInputError({ err, isSkillInputError }: { err: unknown; isSkillInputError: SkillInputErrorTest }, _optional: Record<string, never> = {}): never {
  if (!isSkillInputError({ err })) throw err;
  return rejectSkillInput({ message: err instanceof Error ? err.message : String(err) });
}

/** The authenticated principal's id, handed to the previewed tool as its caller. @complexity O(1). */
export function skillActorId({ context }: { context: SkillRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("skills admin route has no authenticated principal");
  return context.id;
}
