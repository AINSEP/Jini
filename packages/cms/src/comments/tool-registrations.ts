/**
 * @file Comments' half of ADR-049 Decision 4 (ADR-031/SPEC-033/SPEC-035): maps `agent-tools.ts`'s
 * seven catalog entries onto the moderation queue, the four moderation transitions, and the two
 * settings operations, as `ToolRegistration`s. The entire catalog is wired.
 *
 * Authorization shape, and why it differs from Forms/Identity/content-types: `comments/
 * write-service.ts`'s own file header records that "Routes call authorize() first ... then this
 * service, never the repo directly" — the domain functions carry no `authorize()` call to inherit.
 * Six of the seven handlers here therefore perform that check themselves, via the kit's
 * `requireToolPermission`, mirroring each route's exact sequence. That is still ADR-021 §2's "one
 * evaluator": for those six, the single evaluation happens at the handler because that is where the
 * real admin route performs it. The seventh, `comments_update_settings`, is the exception and is
 * documented at its own handler.
 *
 * The host supplies the settings operations, the settings error class, the approval wrapper and
 * the unexpected-key refusal as ports (`CommentsPackageToolDeps`), and adds its own search
 * vocabulary and approval policy around the registrations this file builds.
 */
import { buildDomainRegistrations, indexCatalogById, optionalOneOf, optionalString, readToolLimit, requireInputRecord, requireNumber, requireString, type AgentToolSideEffect, type SurfaceExchangeStore, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
// `ToolInputError` specifically: it is the marker the daemon's tool executor reads to classify a
// rejection 400 rather than redacting it into a message-stripped 500.
import { ToolInputError } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { forbiddenRule, withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { ForbiddenError } from "../core/commands/command.js";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/index.js";
import { commentsAgentToolCatalog } from "./agent-tools.js";
import { CommentNotFoundError, CommentsSettingsValidationError, CommentVersionConflictError } from "./errors.js";
import { resolveHostReadRefs, type HostReadVocabulary } from "../core/tools/host-read-vocabulary.js";
import type { CommentRepoPort } from "./ports.js";
import { COMMENT_STATUSES, type CommentsSettings, type CommentStatus, type ModerationAction, type ModerationQueuePage } from "./types.js";
import type { CommentWriteService } from "./write-service.js";


/** The model relays this verbatim, so it says what is off and that nothing stored was lost. */
function providerNote({ providerId, adapterReady }: { providerId: string | null; adapterReady: boolean }, _options = {}): string {
  if (providerId === null) return 'Public comments are off. Stored comments, settings and the moderation queue are kept; select built-in to show them again.';
  if (!adapterReady) return `The '${providerId}' provider is selected but not ready yet; comments are not showing. Try again shortly.`;
  return `The '${providerId}' provider is selected but comments are disabled in comments settings; enable them there.`;
}

const MUTATES_DURABLE_STATE = 'mutates-durable-state' as const;

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const commentsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  ['comments_get_provider', 'none'],
  ['comments_set_provider', MUTATES_DURABLE_STATE],
  // -> commentRepo.listModerationQueue: read only.
  ["comments_list_moderation_queue", "none"],
  // Workspace-scoped findById, projected through the same moderation view.
  ["comments_get_comment", "none"],
  // -> getCommentsSettings (settings.ts): settingsRepo read only.
  ["comments_get_settings", "none"],
  // -> setCommentsSettings (settings.ts): N ledger set() calls, one per changed field.
  ["comments_update_settings", MUTATES_DURABLE_STATE],
  // -> commentWriteService.applyModeration: status flip + moderation_log append + outbox/hooks.
  ["comments_approve_comment", MUTATES_DURABLE_STATE],
  ["comments_mark_comment_spam", MUTATES_DURABLE_STATE],
  ["comments_trash_comment", MUTATES_DURABLE_STATE],
  ["comments_restore_comment", MUTATES_DURABLE_STATE],
]);

/** What a comment looks like to the model — trims `CommentRecord` to what a moderation decision actually needs. */
function toCommentModerationView(record: {
  id: string;
  entryId: string;
  parentId: string | null;
  status: CommentStatus;
  authorName: string;
  authorEmail: string | null;
  bodyText: string;
  spamScore: number | null;
  createdAt: string;
  version: number;
}) {
  return {
    id: record.id,
    entryId: record.entryId,
    parentId: record.parentId,
    status: record.status,
    authorName: record.authorName,
    authorEmail: record.authorEmail,
    bodyText: record.bodyText,
    spamScore: record.spamScore,
    createdAt: record.createdAt,
    version: record.version,
  };
}

/** Projects a `ModerationQueuePage` into the model-facing shape — `workspaceId`/internal fields (threadRootId, depth, authorIpHash, spamProvider, updatedAt) dropped, same discipline as content-types' `toContentTypeView`. */
function toModerationQueueToolView(page: ModerationQueuePage): { items: ReturnType<typeof toCommentModerationView>[]; nextCursor: string | null } {
  return { items: page.items.map(toCommentModerationView), nextCursor: page.nextCursor };
}

/**
 * The Comments refusals safe to show the model verbatim (wm S16). Without this list every one of
 * them — a permission denial, a stale `expectedVersion`, an unknown id — reached the model as the
 * transport's redacted INTERNAL_ERROR, so it could not tell "retry with the fresh version" from a
 * crash. The messages carry only ids/versions the caller itself supplied or must resend; comment
 * bodies and author data never appear in them.
 */
function commentsModelFacingRules({ settingsForbiddenError }: { settingsForbiddenError: ModelFacingErrorRule["error"] }, _optional = {}): readonly ModelFacingErrorRule[] {
  return [
  forbiddenRule({ domainPrefix: "COMMENTS", error: ForbiddenError }),
  // `comments_update_settings` is refused by the settings kit's own ForbiddenError (a separate
  // class, not a subclass of the cms one) — see that handler's note on self-enforcement.
  forbiddenRule({ domainPrefix: "COMMENTS", error: settingsForbiddenError }),
  { error: CommentNotFoundError, code: "COMMENTS_NOT_FOUND" },
  {
    error: CommentVersionConflictError,
    code: "COMMENTS_VERSION_CONFLICT",
    guidance: "Re-read it with comments_list_moderation_queue and retry with the fresh version",
  },
  ];
}

/** Maps `applyModeration`'s returned failure to the typed domain error the handlers throw. */
function moderationFailureError(required: { commentId: string; result: { reason: "not-found" | "conflict"; currentVersion?: number | undefined } }): Error {
  const { commentId, result } = required;
  return result.reason === "conflict"
    ? new CommentVersionConflictError({ commentId, ...(result.currentVersion !== undefined ? { currentVersion: result.currentVersion } : {}) })
    : new CommentNotFoundError({ commentId });
}

/**
 * Builds one moderation-action tool handler — shared by approve/mark_spam/trash/restore, which
 * differ only in the permission gated on and the `action`/`toStatus` pair passed to
 * `commentWriteService.applyModeration`. Factored out rather than four near-duplicate handlers.
 *
 * `applyModeration`'s success half is `{ok:true}` with no updated record (a real interface
 * limitation, not a shortcut this file takes — `CommentWriteService`'s declared return type
 * carries nothing else back), so the acknowledgement echoes what the model already told it
 * (commentId, the resulting status) — the same "echo the id back" convention
 * `identity_role_delete` uses for a void-resolving domain call.
 *
 * @complexity O(1) beyond the wrapped `applyModeration` call.
 * @overallScore 100
 */
function buildCommentsModerationHandler(
  routeDeps: CommentsPackageToolDeps,
  spec: { permission: string; action: ModerationAction; toStatus: CommentStatus },
): ToolHandler {
  return async (ctx) => {
    const input = requireInputRecord({ input: ctx.input });
    const commentId = requireString({ input: input, key: "commentId" });

    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: spec.permission }, { entityType: "comment", entityId: commentId });

    await routeDeps.commentsReady;
    const result = await routeDeps.commentWriteService.applyModeration({
      workspaceId: routeDeps.workspaceId,
      id: commentId,
      expectedVersion: requireNumber({ input, key: "expectedVersion" }),
      action: spec.action,
      toStatus: spec.toStatus,
      actorPrincipalId: ctx.principal.id,
      note: typeof input.note === "string" ? input.note : null,
    });
    if (!result.ok) {
      throw moderationFailureError({ commentId, result });
    }

    return { moderated: { commentId, toStatus: spec.toStatus } };
  };
}

const COMMENTS_TRASH_TOOL_ID = "comments_trash_comment";

/** See `trash/trash-item-tool.ts`'s identical constant's doc — duplicated here rather than
 *  imported, the same "structurally typed, no `features/trash` import" convention this file's own
 *  header already follows. */
const ASSISTANT_ACTOR_PLUGIN_ID = "assistant";

/** Reads the optional patch members of `comments_update_settings`, requiring at least one — mirrors Forms' `requireFormsPatch`'s identical "no accepted-as-no-op empty patch" discipline. */
function requireCommentsSettingsPatch(input: Record<string, unknown>): Partial<CommentsSettings> {
  const patch: Partial<CommentsSettings> = {};
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (typeof input.requireModeration === "boolean") patch.requireModeration = input.requireModeration;
  if (typeof input.maxDepth === "number") patch.maxDepth = input.maxDepth;
  if (input.closeAfterDays === null || typeof input.closeAfterDays === "number") patch.closeAfterDays = input.closeAfterDays as number | null;
  if (typeof input.spamAutoRejectScore === "number") patch.spamAutoRejectScore = input.spamAutoRejectScore;
  if (typeof input.maxPerIpPerHour === "number") patch.maxPerIpPerHour = input.maxPerIpPerHour;
  if (Object.keys(patch).length === 0) {
    throw new ToolInputError({ message: "at least one of enabled, requireModeration, maxDepth, closeAfterDays, spamAutoRejectScore, maxPerIpPerHour is required" });
  }
  return patch;
}

/** A host-free view of the surfaces the approval-gated tool needs: the store the confirmation opens on. */
export interface CommentsPackageSurfaces {
  readonly surfaceExchanges: SurfaceExchangeStore;
}

/** The comments settings operations the tools call; the host binds them to its settings ledger. */
export interface CommentsSettingsPort {
  get(input: { workspaceId: string }): Promise<CommentsSettings>;
  set(input: { workspaceId: string; patch: Partial<CommentsSettings>; callerPrincipalId: string }): Promise<CommentsSettings>;
}

/** The members of the comments provider registry the tools call. */
export interface CommentsProviderRegistryPort {
  active(required: { siteId: string }): Promise<{ providerId: string | null; revision: number; adapter: unknown }>;
  select(required: { siteId: string; providerId: string | null; expectedRevision: number; actorPrincipalId: string }): Promise<void>;
}

/** What the provider-change confirmation shows; only the fields the handler sets. */
export interface CommentsApprovalDescription {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly access: {
    readonly resources: readonly {
      readonly id: string;
      readonly label: string;
      readonly scope: { readonly personId: string; readonly siteId: string };
      readonly previous: string;
      readonly proposed: string;
      readonly revision: string;
    }[];
  };
  readonly details: readonly { readonly label: string; readonly value: string }[];
  readonly warning: string;
  readonly confirmLabel: string;
}

/** The host's approval wrapper (ask a person, then run once): the steps and the result flag the tool supplies. */
export interface CommentsApprovalHandler {
  <TPrepared>(
    steps: {
      surfaces: CommentsPackageSurfaces;
      prepare: (required: { ctx: ToolExecutionContext }) => Promise<TPrepared>;
      describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => CommentsApprovalDescription;
      run: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => Promise<unknown>;
    },
    options: { flag: string },
  ): ToolHandler;
}

/**
 * Everything the comments tool handlers read, as ports: the host (the route deps bag) supplies the
 * settings operations, the settings error class, the approval wrapper and the unexpected-key refusal.
 */
export interface CommentsPackageToolDeps {
  readonly commentsProviders?: CommentsProviderRegistryPort | undefined;
  readonly authorize: AuthorizeFn;
  readonly workspaceId: string;
  readonly commentsReady: Promise<void>;
  readonly commentsSettingsReady: Promise<void>;
  readonly commentRepo: CommentRepoPort;
  readonly commentWriteService: CommentWriteService;
  readonly commentsSettings: CommentsSettingsPort;
  /** The settings ledger's own refusal class, listed with the model-facing rules in the same position. */
  readonly settingsForbiddenError: ModelFacingErrorRule["error"];
  readonly approvalHandler: CommentsApprovalHandler;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
}

/** The two things every handler factory reads: the package deps and the surfaces. */
interface CommentsHandlerArgs {
  deps: CommentsPackageToolDeps;
  surfaces: CommentsPackageSurfaces;
}

const providerRegistry = ({ deps }: { deps: CommentsPackageToolDeps }, _optional = {}) => {
  if (!deps.commentsProviders) throw new ToolInputError({ message: 'Comments provider service is unavailable.' });
  return deps.commentsProviders;
};

const providerPermission = async ({ deps, principalId }: { deps: CommentsPackageToolDeps; principalId: string }, _optional = {}) => {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId, permission: 'comments.configure' }, { entityType: 'comments-provider' });
  await Promise.all([deps.commentsReady, deps.commentsSettingsReady]);
};

const commentsGetProviderHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async ctx => {
  await providerPermission({ deps, principalId: ctx.principal.id });
  const active = await providerRegistry({ deps }).active({ siteId: deps.workspaceId });
  const settings = await deps.commentsSettings.get({ workspaceId: deps.workspaceId });
  const ready = !!active.adapter && settings.enabled;
  return { providerId: active.providerId, revision: active.revision, ready,
    pendingCount: await deps.commentRepo.countByStatus({ workspaceId: deps.workspaceId, status: 'pending' }),
    ...(ready ? {} : { note: providerNote({ providerId: active.providerId, adapterReady: !!active.adapter }) }) };
};

const commentsSetProviderHandler = ({ deps, surfaces }: CommentsHandlerArgs): ToolHandler => deps.approvalHandler({ surfaces,
  prepare: async ({ ctx }) => {
    const input = requireInputRecord({ input: ctx.input });
    deps.refuseUnexpectedKeys(input, ['providerId', 'expectedRevision']);
    if (input.providerId !== null && input.providerId !== 'built-in') throw new ToolInputError({ message: 'Select built-in or null to disable comments.' });
    const expectedRevision = requireNumber({ input, key: 'expectedRevision' });
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ToolInputError({ message: 'expectedRevision must be a non-negative integer.' });
    await providerPermission({ deps, principalId: ctx.principal.id });
    const current = await providerRegistry({ deps }).active({ siteId: deps.workspaceId });
    if (current.revision !== expectedRevision) throw new ToolInputError({ message: 'Comments provider changed; read it again.' });
    return { providerId: input.providerId as string | null, previousProviderId: current.providerId, expectedRevision,
      pendingCount: await deps.commentRepo.countByStatus({ workspaceId: deps.workspaceId, status: 'pending' }) };
  },
  describe: ({ ctx, prepared }) => ({ toolId: 'comments_set_provider', errorCode: 'COMMENTS', title: 'Change the comments provider?',
    access: { resources: [{ id: 'core.comments.provider', label: 'Provider', scope: { personId: ctx.principal.id, siteId: deps.workspaceId },
      previous: prepared.previousProviderId ?? 'Disabled', proposed: prepared.providerId ?? 'Disabled', revision: String(prepared.expectedRevision) }] },
    details: [{ label: 'Pending stored comments', value: String(prepared.pendingCount) }],
    warning: 'Switching or disabling hides public stored comments. Stored data and the readable moderation queue are preserved.', confirmLabel: 'Change provider' }),
  run: async ({ ctx, prepared }) => {
    await providerPermission({ deps, principalId: ctx.principal.id });
    const pendingCount = await deps.commentRepo.countByStatus({ workspaceId: deps.workspaceId, status: 'pending' });
    if (pendingCount > prepared.pendingCount) throw new ToolInputError({ message: 'More comments arrived. Review a fresh provider confirmation.' });
    await providerRegistry({ deps }).select({ siteId: deps.workspaceId, providerId: prepared.providerId, expectedRevision: prepared.expectedRevision, actorPrincipalId: ctx.principal.id });
    return { changed: true, providerId: prepared.providerId };
  },
}, { flag: 'changed' });

/** Reads any status directly; pagination cannot establish that an id is absent. */
const commentsGetCommentHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async (ctx) => {
  const commentId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "commentId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "comments.read" }, { entityType: "comment", entityId: commentId });
  await deps.commentsReady;
  const comment = await deps.commentRepo.findById({ workspaceId: deps.workspaceId, id: commentId });
  if (!comment) throw new CommentNotFoundError({ commentId });
  return { comment: toCommentModerationView(comment) };
};

const commentsListModerationQueueHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });

  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "comments.read" }, { entityType: "comment" });

  await deps.commentsReady;
  const status: CommentStatus = optionalOneOf({ input, key: "status", values: COMMENT_STATUSES }) ?? "pending";
  const limit = readToolLimit({ input, max: 100, fallback: 20 });
  // A non-string cursor is refused, not read as "no cursor" and page 1.
  const cursor = optionalString({ input, key: "cursor" }) ?? null;
  const page = await deps.commentRepo.listModerationQueue({ workspaceId: deps.workspaceId, status, limit, cursor });
  return toModerationQueueToolView(page);
};

const commentsGetSettingsHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async (ctx) => {
  // `getCommentsSettings` has no `authorize` in its deps at all (unlike `setCommentsSettings`,
  // which self-enforces via its own `set()` call below) — the GET route gates explicitly
  // before calling it, so this handler mirrors that same explicit call.
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "comments.configure" }, { entityType: "comments-settings" });

  await deps.commentsSettingsReady;
  const settings = await deps.commentsSettings.get({ workspaceId: deps.workspaceId });
  return { settings };
};

const commentsUpdateSettingsHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async (ctx) => {
  const patch = requireCommentsSettingsPatch(requireInputRecord({ input: ctx.input }));

  // No explicit pre-check here, unlike every other Comments handler: the host's settings port
  // self-enforces the configure permission inside its own write, which is ADR-021 §2's "one
  // evaluator" reached the domain-function way Forms/Identity use, not the explicit-handler way the
  // rest of this file uses. The host binding documents that override beside the port it supplies.
  await deps.commentsSettingsReady;
  ctx.signal.throwIfAborted();
  const settings = await deps.commentsSettings.set(
    { workspaceId: deps.workspaceId, patch, callerPrincipalId: ctx.principal.id },
  ).catch((error: unknown) => {
    if (error instanceof CommentsSettingsValidationError) throw new ToolInputError({ message: error.message });
    throw error;
  });
  return { settings };
};

const commentsApproveCommentHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => buildCommentsModerationHandler(deps, { permission: "comments.moderate", action: "approve", toStatus: "approved" });

const commentsMarkCommentSpamHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => buildCommentsModerationHandler(deps, { permission: "comments.moderate", action: "mark_spam", toStatus: "spam" });

/** Reversibly trashes a comment through the existing moderation and version checks. */
const commentsTrashCommentHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const commentId = requireString({ input: input, key: "commentId" });
  const expectedVersion = requireNumber({ input, key: "expectedVersion" });

  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "comments.delete" }, { entityType: "comment", entityId: commentId });

  await deps.commentsReady;
  const existing = await deps.commentRepo.findById({ workspaceId: deps.workspaceId, id: commentId });
  if (!existing) throw new CommentNotFoundError({ commentId });

  // Re-check authorization immediately before the service write.
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "comments.delete" }, { entityType: "comment", entityId: commentId });
  const result = await deps.commentWriteService.applyModeration({
    workspaceId: deps.workspaceId,
    id: commentId,
    expectedVersion,
    action: "trash",
    toStatus: "trash",
    actorPrincipalId: ctx.principal.id,
    actorPluginId: ASSISTANT_ACTOR_PLUGIN_ID,
    note: typeof input.note === "string" ? input.note : null,
  });
  if (!result.ok) {
    throw moderationFailureError({ commentId, result });
  }

  return { trashed: true, cancelled: false, moderated: { commentId, toStatus: "trash" } };

};

const commentsRestoreCommentHandler = ({ deps }: CommentsHandlerArgs): ToolHandler => buildCommentsModerationHandler(deps, { permission: "comments.moderate", action: "restore", toStatus: "approved" });

/**
 * The package-side builder: the id -> handler table over the comments catalog. It takes no host
 * metadata (search vocabulary, approval policy) and no default surfaces; the host binding adds both.
 */
export function buildCommentsToolRegistrations(
  { deps, surfaces }: { deps: CommentsPackageToolDeps; surfaces: CommentsPackageSurfaces },
  { hostReads }: { hostReads?: HostReadVocabulary | undefined } = {},
): ToolRegistration[] {
  const args: CommentsHandlerArgs = { deps, surfaces };
  const handlers: Record<string, ToolHandler> = {
    comments_get_provider: commentsGetProviderHandler(args),
    comments_set_provider: commentsSetProviderHandler(args),
    comments_get_comment: commentsGetCommentHandler(args),
    comments_list_moderation_queue: commentsListModerationQueueHandler(args),
    comments_get_settings: commentsGetSettingsHandler(args),
    comments_update_settings: commentsUpdateSettingsHandler(args),
    comments_approve_comment: commentsApproveCommentHandler(args),
    comments_mark_comment_spam: commentsMarkCommentSpamHandler(args),
    comments_trash_comment: commentsTrashCommentHandler(args),
    comments_restore_comment: commentsRestoreCommentHandler(args),
  };

  // No `unwiredToolIds`: Comments wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({
    domain: "comments",
    catalogModule: "comments/agent-tools.ts",
    catalog: indexCatalogById({ catalog: resolveHostReadRefs({ value: commentsAgentToolCatalog }, { hostReads }) }),
    // Wrapped once over the whole map, never per handler — see `withModelFacingErrors`' own doc.
    handlers: withModelFacingErrors({ handlers, rules: commentsModelFacingRules({ settingsForbiddenError: deps.settingsForbiddenError }) }),
    derivedRisk: commentsDerivedRisk,
  });
}
