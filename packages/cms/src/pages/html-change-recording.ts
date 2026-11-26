import type { PageHtmlOperation, PageHtmlWriteOutcome, RecordedHtmlWrites } from "@jini-ai/core/contracts/site/page-html-store";
import type { ChangeSetRepoPort, ExecuteCommandFn, OutboxPort, AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { Clock, IdGenerator, JsonObject } from "@jini-ai/core/primitives";
import type { PostRecord, PostRepoPort } from "@jini-ai/cms/posts/post";
import { ToolInputError } from "@jini-ai/core";

import { PageConcurrentEditError } from "@jini-ai/cms/pages/html-document-store";
import { PAGE_HTML_ENTITY_TYPE, pageHtmlInverseOf } from "./html-inverse.js";


/** The assistant tools whose real HTML changes earn a recorded Undo. */


/** Short, HTML-free summaries: change-set summaries are listed to the model and to History. */


/**
 * Whether this composition can run a recorded HTML write at all (FIX 11). `enabled` only where one
 * transaction spans the page write, its revisions, events and the change-set record (sqlite,
 * postgres). The in-memory composition binds `disabled`: its post snapshot does not cover the
 * change-set repo or the outbox, so a late failure would orphan the Undo record.
 */


/** The collaborators recording needs beyond the page store the write itself closes over. */
export interface PageHtmlRecordingDeps {
  editPermission: string;
  summary: Readonly<Record<PageHtmlOperation, string>>;
  /** Required, never defaulted: each composition states whether it has the shared rollback boundary. */
  recordedHtmlWrites: RecordedHtmlWrites;
  executeCommand: ExecuteCommandFn;
  clock: Clock;
  idGen: IdGenerator;
  changeSets: ChangeSetRepoPort;
  outbox?: OutboxPort | undefined;
  authorize: AuthorizeFn;
  postRepo: Pick<PostRepoPort, "findById" | "transaction">;
}

/** What one store operation did: `changed: false` covers refusals and unchanged normalized writes. */


/** Carries an unchanged or refused outcome out of the command so it never reaches the record step. */
class UnrecordedPageHtmlWrite<T> extends Error {
  readonly outcome: PageHtmlWriteOutcome<T>;
  constructor(outcome: PageHtmlWriteOutcome<T>) {
    super("page html write changed nothing");
    this.outcome = outcome;
  }
}

/**
 * Runs one assistant HTML store operation and records exactly one scoped `page-html` change set for
 * it, both inside one outer transaction: a change-set insert failure rolls the page write, its
 * revisions, references and events back with it (`executeCommand` itself opens no transaction).
 *
 * The inverse is captured from the scoped live row at the start of that transaction and the write
 * must land on that same version: the inverse and the CAS share one basis, so an Undo can only ever
 * restore the body this write actually replaced. A refusal or an unchanged write records nothing,
 * and `changeSetId` is returned only after the record commits — only a committed record earns an
 * Undo claim. The execution id is correlation for the idempotency key, never authority.
 *
 * @throws `ToolInputError` before anything is opened when `recordedHtmlWrites` is `disabled`;
 * whatever the write throws, after the transaction rolls back; `PageConcurrentEditError` if
 * the captured row was not at `expectedVersion`.
 * @complexity O(1) besides `write`.
 */
export async function recordAssistantPageHtmlWrite<T>(
  { deps, target, expectedVersion, operation, write, signal }: {
    deps: PageHtmlRecordingDeps;
    target: { workspaceId: string; pageId: string; actorId: string; executionId: string };
    expectedVersion: number;
    operation: PageHtmlOperation;
    write: () => Promise<PageHtmlWriteOutcome<T>>;
    signal: AbortSignal;
  },
  _optional = {},
): Promise<{ value: T; version: number | null; changeSetId?: string }> {
  // Before the first durable operation, including a doc Page's one-way conversion.
  signal.throwIfAborted();
  if (deps.recordedHtmlWrites !== "enabled") {
    throw new ToolInputError({ message: "Assistant HTML page edits are not available on this site's storage: it cannot record the edit and its Undo together. Nothing was written." });
  }
  let captured: PostRecord | null = null;
  try {
    const { result, changeSetId } = await deps.postRepo.transaction({ fn: () => deps.executeCommand<PageHtmlWriteOutcome<T>>({
      // Same permission on the same `post` target as the writer's own check.
      deps: { clock: deps.clock, idGen: deps.idGen, changeSets: deps.changeSets, outbox: deps.outbox, authorize: (params) => deps.authorize({ ...params, entityType: "post" }) },
      command: {
        workspaceId: target.workspaceId,
        actor: { id: target.actorId, kind: "agent" },
        summary: deps.summary[operation],
        idempotencyKey: `page-html:${operation}:${target.pageId}:${target.executionId}`,
        permission: deps.editPermission,
      },
      mutation: {
        entityType: PAGE_HTML_ENTITY_TYPE,
        entityId: target.pageId,
        operation: "update",
        captureInverse: async () => {
          captured = await deps.postRepo.findById({ workspaceId: target.workspaceId, id: target.pageId });
          return captured ? (pageHtmlInverseOf({ row: captured }) as JsonObject | null) : null;
        },
        execute: async () => {
          const outcome = await write();
          if (!outcome.changed) throw new UnrecordedPageHtmlWrite(outcome);
          const basis = captured as PostRecord | null;
          if (!basis || basis.version !== expectedVersion) {
            throw new PageConcurrentEditError(`page '${target.pageId}' was edited elsewhere since this turn started — re-read and retry`);
          }
          return outcome;
        },
        captureEntityVersion: ({ result }) => result.version,
      },
    }) });
    return { value: result.value, version: result.version, changeSetId };
  } catch (err) {
    if (err instanceof UnrecordedPageHtmlWrite) return { value: err.outcome.value as T, version: err.outcome.version };
    throw err;
  }
}
