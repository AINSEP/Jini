import { nowIso, type Clock } from "@jini-ai/core/primitives";
import type {
  EmailTemplateHtmlSession,
  EmailTemplateRecord,
  EmailTemplateStore,
} from "@jini-ai/platform/mail/email-template-operations";

import { type PostRecord, type PostRepoPort } from "@jini-ai/cms/posts/post";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
// Not from the barrel: it re-exports a fixed list, and this kind is not part of the Post API.
import { EMAIL_TEMPLATE_KIND } from "@jini-ai/cms/posts/post";
import { PageConcurrentEditError } from "../pages/html-document-store.js";
import type { PagesHtmlDocumentStoreFactory } from "@jini-ai/core/contracts/site/page-html-store";

/**
 * @file Storage binding for the email-template operations in
 * `@jini-ai/platform/mail/email-template-operations` (create, edit, rename, list, get, preview and the
 * send render). Both the admin routes (`server/inbound/admin-http/routes/email-templates/`) and the
 * assistant tools (`tool-registrations.ts`) call those operations with `emailTemplateStore({ deps })`.
 * Permission checks stay with those two callers, the way the Pages routes and `pages_*` tools each
 * check before reaching the shared store.
 *
 * Storage is the Pages storage, not a parallel system: a template is a `posts` row of kind
 * {@link EMAIL_TEMPLATE_KIND}, written in `"html"` format by the same `PagesHtmlDocumentStore` a
 * bespoke Page is (compare-and-set writes, revision ledger, trash). It is born like a Page too — a
 * plain row, then `ensureHtmlFormat(seed)` — so that store stays the only writer of html bodies.
 */

export interface EmailTemplateDeps {
  workspaceId: string;
  postRepo: PostRepoPort;
  pagesHtmlStore: PagesHtmlDocumentStoreFactory;
  clock: Clock;
  idGen: { newId(): string };
  EmailTemplateNotFoundError: new (message: string) => Error;
}

/** A template row: our kind, html format, not in the Trash. */
function isTemplateRow(row: PostRecord | null): row is PostRecord & { bodyHtml: string } {
  if (row === null) return false;
  return (row.kind as string) === EMAIL_TEMPLATE_KIND && row.bodyFormat === "html" && row.bodyHtml !== null && !isTrashed(row);
}

function toRecord(row: PostRecord & { bodyHtml: string }, _options = {}): EmailTemplateRecord {
  return { id: row.id, name: row.title, html: row.bodyHtml, version: row.version, updatedAt: row.updatedAt };
}

async function findTemplateRow({ deps, id }: { deps: EmailTemplateDeps; id: string }, _options = {}): Promise<(PostRecord & { bodyHtml: string }) | null> {
  const row = await deps.postRepo.findById({ workspaceId: deps.workspaceId, id });
  return isTemplateRow(row) ? row : null;
}

/** A fresh, `doc`-format template row for `ensureHtmlFormat` to convert, as a new Page is. */
function newTemplateRow({ deps, name }: { deps: EmailTemplateDeps; name: string }, _options: Record<string, never> = {}): PostRecord {
  const id = deps.idGen.newId();
  return {
    id,
    workspaceId: deps.workspaceId,
    title: name,
    // The colon fails `SLUG_FORMAT_PATTERN`, so no Post or Page can ever be given this slug: the row
    // holds a place in the shared unique index without taking a name from the public URL space.
    slug: `email-template:${id}`,
    bodyJson: { type: "doc", content: [] },
    // Forever: `updatePost` refuses this kind, and it is the only path that changes status.
    status: "draft",
    // Not a PostKind on purpose; see EMAIL_TEMPLATE_KIND's own doc.
    kind: EMAIL_TEMPLATE_KIND,
    bodyFormat: "doc",
    bodyHtml: null,
    updatedAt: nowIso({ clock: deps.clock }),
    version: 1,
  };
}

/** A Pages html store scoped to one template; only the email-template kind may pass through it. */
function templateHtmlStore({ deps, id, actorId }: { deps: EmailTemplateDeps; id: string; actorId: string }, _options = {}) {
  return deps.pagesHtmlStore({ workspaceId: deps.workspaceId, postId: id, actorId }, { allowedKinds: new Set([EMAIL_TEMPLATE_KIND]) });
}

/** A plain row, then the Pages store's `ensureHtmlFormat` births its HTML body, as a new Page is. */
async function createTemplateRow({ deps, name, seedHtml, actorId }: { deps: EmailTemplateDeps; name: string; seedHtml: string; actorId: string }, _options = {}): Promise<EmailTemplateRecord> {
  const row = newTemplateRow({ deps: deps, name: name });
  // Both adapters join the same kernel transaction, so conversion failure leaves no hidden doc row.
  return deps.postRepo.transaction({ fn: async () => {
    await deps.postRepo.save(row);
    await templateHtmlStore({ deps, id: row.id, actorId }).ensureHtmlFormat({ seedHtml });
    const created = await findTemplateRow({ deps, id: row.id });
    if (created === null) throw new deps.EmailTemplateNotFoundError(`email template '${row.id}' was not found`);
    return toRecord(created);
  } });
}

/** Reads through the Pages store so its captured version conditions the one write; a concurrent edit is `false`. */
async function openTemplateHtml({ deps, id, actorId }: { deps: EmailTemplateDeps; id: string; actorId: string }, _options = {}): Promise<EmailTemplateHtmlSession> {
  const store = templateHtmlStore({ deps, id, actorId });
  await store.read();
  return {
    version: store.capturedVersion(),
    write: async ({ html }) => {
      try {
        await store.write({ html });
        return true;
      } catch (err) {
        if (err instanceof PageConcurrentEditError) return false;
        throw err;
      }
    },
  };
}

/**
 * Only the row's title changes, through the post repo's compare-and-set write, so the HTML body and
 * its revision ledger are untouched. Added for the admin Templates list (2026-10-22); the HTML store
 * has no title of its own, which is why this is not a store write.
 */
async function renameTemplateRow({ deps, id, name, ifVersion }: { deps: EmailTemplateDeps; id: string; name: string; ifVersion: number }, _options = {}): Promise<boolean> {
  const row = await findTemplateRow({ deps, id });
  if (row === null) return false;
  const record = { ...row, title: name, version: row.version + 1, updatedAt: nowIso({ clock: deps.clock }) };
  const { applied } = await deps.postRepo.saveIfVersion({ record, ifVersion });
  return applied;
}

async function listTemplatePage({ deps, limit, before }: { deps: EmailTemplateDeps; limit: number; before?: { updatedAt: string; id: string } }, _options = {}): Promise<Array<EmailTemplateRecord | null>> {
  if (!deps.postRepo.listHtmlByKind) throw new Error("Template listing is unavailable.");
  const rows = await deps.postRepo.listHtmlByKind({ workspaceId: deps.workspaceId, kind: EMAIL_TEMPLATE_KIND, limit, ...(before ? { before } : {}) });
  return rows.map((row) => (isTemplateRow(row) ? toRecord(row) : null));
}

/** The `EmailTemplateStore` the shared operations run on: Pages storage in this workspace. */
export function emailTemplateStore({ deps }: { deps: EmailTemplateDeps }, _options = {}): EmailTemplateStore {
  return {
    find: async ({ id }) => {
      const row = await findTemplateRow({ deps, id });
      return row === null ? null : toRecord(row);
    },
    create: (args) => createTemplateRow({ deps, ...args }),
    openHtml: (args) => openTemplateHtml({ deps, ...args }),
    rename: (args) => renameTemplateRow({ deps, ...args }),
    listPage: (args) => listTemplatePage({ deps, ...args }),
  };
}
