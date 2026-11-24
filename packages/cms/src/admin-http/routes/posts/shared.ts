import type { CommandMutation, ExecuteCommandDeps } from "@jini-ai/core/contracts/events";
import { ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { DuplicateCommandError, ForbiddenError, executeCommand } from "../../../core/commands/command.js";

/**
 * @file Shared plumbing for the posts AND pages create/update/delete admin route specs (a Page is a
 * `posts` row): the `Idempotency-Key` reader, the actor, the command-gateway call every one of them
 * makes, and the ordered `catch` ladder each maps its thrown errors with.
 *
 * Authorization is NOT the mount's `authorize` handle here: every one of these routes is authorized by
 * the command gateway itself (`executeCommand` asks the injected authorizer for `content.write`, before
 * its idempotency lookup, and throws `ForbiddenError`), exactly as the hand-written routes were.
 */

/** The principal the host authenticate port hands these routes: only its id is read (the actor). */
export interface ContentWriteRoutePrincipal { id: string }

/** An entry as these routes see it: the version the gateway records. The host's own callbacks read the rest. */
export interface ContentEntry { readonly version: number }

/** The gateway's collaborators, all required here (the host decides, explicitly). */
export type ContentCommandDeps = Required<Pick<ExecuteCommandDeps, "clock" | "idGen" | "changeSets" | "outbox" | "authorize">>;

/** Fields every content write route reads. Callbacks taking the host's entry are methods (the host's record type is wider). */
export interface ContentWriteBaseDeps {
  workspaceId: string;
  commandDeps: ContentCommandDeps;
  /** Delivers the outbox at once (SEO's sitemap-cache invalidation), ahead of the background drainer. */
  drainOutbox: () => Promise<void>;
  /** The host's admin post serializer — the success body. */
  toAdminPostResponse(required: { post: ContentEntry }): object;
}

/** Reads one of the host's error classes; the host owns them, the spec only maps them. */
export type ContentErrorTest = (required: { err: unknown }) => boolean;

/** What a mutation's `captureInverse` stores: the gateway's own inverse payload type. */
export type ContentInverse = Awaited<ReturnType<CommandMutation<unknown>["captureInverse"]>>;

/** The request header these routes opt into (`readHeaders`), lower-cased as the host hands it over. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** The `Idempotency-Key` header; an empty value is absent, as the host's `req.get(…) || undefined` read it. @complexity O(1). */
export function idempotencyKeyOf({ headers }: { headers: Readonly<Record<string, string>> | undefined }, _optional: Record<string, never> = {}): string | undefined {
  return headers?.[IDEMPOTENCY_KEY_HEADER] || undefined;
}

/** A path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function pathParam({ params, name }: { params: Record<string, string | undefined>; name: string }, _optional: Record<string, never> = {}): string {
  return String(params[name] ?? "");
}

/** The acting principal's id. No principal is a wiring bug, so it fails closed. @complexity O(1). */
export function contentWriteActorId({ context, family }: { context: ContentWriteRoutePrincipal | undefined; family: string }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error(`${family} admin route has no authenticated principal`);
  return context.id;
}

/** One content-write command: the envelope fields plus the mutation, whose entity type is always `post`. */
export interface ContentCommand<T extends { post: ContentEntry }> extends Pick<CommandMutation<T>, "entityId" | "operation" | "captureInverse" | "execute" | "rollback"> {
  readonly actorId: string;
  readonly idempotencyKey: string | undefined;
  readonly summary: string;
}

/**
 * Runs one write through the command gateway as a `content.write` command by the acting user, recording
 * the written entry's version, and returns the mutation's result.
 * @complexity O(1) plus the gateway and the injected mutation.
 */
export async function runContentCommand<T extends { post: ContentEntry }>(
  { deps, command }: { deps: Pick<ContentWriteBaseDeps, "workspaceId" | "commandDeps">; command: ContentCommand<T> },
  _optional: Record<string, never> = {},
): Promise<T> {
  const { actorId, idempotencyKey, summary, ...mutation } = command;
  const { result } = await executeCommand<T>({
    deps: deps.commandDeps,
    command: { workspaceId: deps.workspaceId, actor: { id: actorId, kind: "user" }, summary, idempotencyKey, permission: "content.write" },
    mutation: { entityType: "post", ...mutation, captureEntityVersion: ({ result }) => result.post.version },
  });
  return result;
}

/** One `catch` rung: which thrown error it answers, with which status and body. */
export interface ContentErrorRung {
  readonly matches: ContentErrorTest;
  readonly status: number;
  readonly body: (required: { err: unknown }) => object;
}

const messageOf = (err: unknown): string => (err as Error).message;

/** The gateway's authorization refusal: the permission and the authorizer's reason. */
export const FORBIDDEN_RUNG: ContentErrorRung = {
  matches: ({ err }) => err instanceof ForbiddenError,
  status: 403,
  body: ({ err }) => ({ error: messageOf(err), code: "FORBIDDEN", details: { permission: (err as ForbiddenError).permission, reason: (err as ForbiddenError).reason } }),
};

/** A reused `Idempotency-Key`: the change set that already answered it. */
export const DUPLICATE_RUNG: ContentErrorRung = {
  matches: ({ err }) => err instanceof DuplicateCommandError,
  status: 409,
  body: ({ err }) => ({ error: messageOf(err), code: "DUPLICATE_COMMAND", changeSetId: (err as DuplicateCommandError).changeSetId }),
};

/** A rung answering the error's own message, with `code` only when the hand-written route sent one. @complexity O(1). */
export function messageRung({ matches, status }: { matches: ContentErrorTest; status: number }, optional: { code?: string } = {}): ContentErrorRung {
  const { code } = optional;
  return { matches, status, body: ({ err }) => (code === undefined ? { error: messageOf(err) } : { error: messageOf(err), code }) };
}

/**
 * Refuses with the first matching rung (a plugin hook's refusal first, when the route saves through
 * one); anything unmapped is rethrown unchanged, so the host's error port answers its redacted 500.
 * @complexity O(n) in the route's fixed rung list.
 */
export function rejectContentWriteError(
  { err, rungs }: { err: unknown; rungs: readonly ContentErrorRung[] },
  optional: { rejectPluginHookFailure?: (required: { err: unknown }) => void } = {},
): never {
  optional.rejectPluginHookFailure?.({ err });
  const rung = rungs.find((candidate) => candidate.matches({ err }));
  if (!rung) throw err;
  throw new RouteRefusalError({ status: rung.status, body: rung.body({ err }) });
}

/** The host's id-or-slug lookup: the entry's stable id, or the host's not-found error for no match. */
export type EntryIdLookupFn = (required: { workspaceId: string; idOrSlug: string }) => Promise<string>;

/**
 * Admin URLs use the slug when one resolves (2026-08-10) — resolve to the real stable id up front,
 * before the command gateway starts, so `entityId`/`captureInverse`/the write all key off the same
 * real id even when the URL's own slug is one of the fields being changed in this very request.
 * Falls back to the raw param on no match, which reaches the exact same "not found" 404 path the
 * route already had. Any other failure propagates to the caller.
 * @complexity O(1) plus the injected lookup.
 */
export async function resolveEntryId(
  { deps, rawParam }: { deps: { workspaceId: string; findPostId: EntryIdLookupFn; postErrors: { isNotFound: ContentErrorTest } }; rawParam: string },
  _optional: Record<string, never> = {},
): Promise<string> {
  try {
    return await deps.findPostId({ workspaceId: deps.workspaceId, idOrSlug: rawParam });
  } catch (err) {
    // A missing post keeps the existing raw-id lookup and not-found response.
    if (deps.postErrors.isNotFound({ err })) return rawParam;
    throw err;
  }
}

/** The deps a create route reads: the host's create service, its two error tests and its hook-failure binding. */
export interface ContentCreateDeps extends ContentWriteBaseDeps {
  /** The host's create service over the request body (it reads each field only as the body supplies it). */
  createEntry: (required: { workspaceId: string; id: string; actorId: string; body: unknown }) => Promise<{ post: ContentEntry }>;
  postErrors: { isValidation: ContentErrorTest; isConflict: ContentErrorTest };
  rejectPluginHookFailure: (required: { err: unknown }) => void;
}

/** A create route's input: the untouched body and the `Idempotency-Key`. */
export interface ContentCreateInput { body: unknown; idempotencyKey: string | undefined }

/**
 * Creates a new entry (fresh id) as one `create` command with no inverse, drains the outbox so a
 * create published at once reaches SEO's sitemap-cache invalidation before the response, and answers
 * the serialized entry. Errors: hook 500, 403, duplicate 409, validation 400, slug-conflict 409.
 * @complexity O(1) plus the gateway and the injected service.
 */
export async function handleContentCreate(
  { input, deps, context }: { input: ContentCreateInput; deps: ContentCreateDeps; context: ContentWriteRoutePrincipal | undefined },
  { summary, family }: { summary: string; family: string },
) {
  const actorId = contentWriteActorId({ context, family });
  const id = deps.commandDeps.idGen.newId();
  try {
    const result = await runContentCommand({ deps, command: {
      actorId, idempotencyKey: input.idempotencyKey, summary, entityId: id, operation: "create",
      captureInverse: async () => null,
      execute: () => deps.createEntry({ workspaceId: deps.workspaceId, id, actorId, body: input.body }),
    } });
    await deps.drainOutbox();
    return ok({ value: deps.toAdminPostResponse({ post: result.post }) });
  } catch (err) {
    return rejectContentWriteError({ err, rungs: [
      FORBIDDEN_RUNG, DUPLICATE_RUNG,
      messageRung({ matches: deps.postErrors.isValidation, status: 400 }, { code: "VALIDATION_ERROR" }),
      messageRung({ matches: deps.postErrors.isConflict, status: 409 }, { code: "SLUG_CONFLICT" }),
    ] }, { rejectPluginHookFailure: deps.rejectPluginHookFailure });
  }
}

/** An entry as the page routes see it: the version plus the kind the page check reads. */
export interface ContentEntryWithKind extends ContentEntry { readonly kind?: string }

/** The two page-route deps the page-kind check reads. */
export interface PageLookupDeps {
  workspaceId: string;
  findEntry: (required: { workspaceId: string; id: string }) => Promise<ContentEntryWithKind | null>;
  /** The host's not-found error (so the route's own not-found rung answers it). */
  pageNotFound: (required: { message: string }) => Error;
}

/**
 * The pre-write page: a missing row or a row of any other kind (a Post) is "page not found", thrown
 * as the host's not-found error before anything is written, so a page route can never edit or trash a Post.
 * @complexity O(1) plus the injected lookup.
 */
export async function findPageOrNotFound({ deps, pageId }: { deps: PageLookupDeps; pageId: string }, _optional: Record<string, never> = {}): Promise<ContentEntryWithKind> {
  const existing = await deps.findEntry({ workspaceId: deps.workspaceId, id: pageId });
  if (existing?.kind !== "page") throw deps.pageNotFound({ message: `page '${pageId}' was not found` });
  return existing;
}
