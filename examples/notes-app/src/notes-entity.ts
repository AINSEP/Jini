/**
 * @file The notes as one `AdminErasedEntityPort`, a mapping over the `@jini-ai/cms/entries` services (which
 * stay the owner of every rule). Every write carries the version the caller read as `expectedVersion`, so a
 * stale writer, human or assistant, gets CONFLICT and changes nothing.
 */
import type { AdminEntityPage, AdminEntityListQuery, AdminEntityRowData, AdminErasedEntityPort } from '@jini-ai/admin/core';
import {
  createEntry, EntryFieldValidationError, EntryNotFoundError, EntrySlugConflictError, listEntries, publishEntry, unpublishEntry,
  updateEntry, VersionConflictError, type EntryRecord, type EntryRepoPort, type EntryListPort,
} from '@jini-ai/cms/entries';
import { filterNotesByText } from './gaps/note-search.ts';
import { NOTE_DESCRIPTOR, NoteEntityError } from './note-descriptor.ts';
import { readCreateInput, readUpdateInput, type NoteUpdateInput } from './note-input.ts';
import { noteBody } from './note-body.ts';
import { NOTE_TYPE, WORKSPACE_ID } from './ports.ts';

type EntryDeps = Parameters<typeof updateEntry>[0]['deps'];
export interface NoteEntityDeps {
  readonly entryRepo: EntryRepoPort & EntryListPort;
  readonly entryDeps: EntryDeps;
  readonly ids: { newId: () => string };
  readonly actor: { readonly actorId: string; readonly principalKind: 'user' };
}
type NoteRow = AdminEntityRowData & { title: string; body: string };

const toRow = ({ entry }: { entry: EntryRecord }): NoteRow => ({
  id: entry.id, title: entry.title, slug: entry.slug, body: noteBody({ entry }), status: entry.status, version: entry.version, updatedAt: entry.updatedAt,
});

/** The service's typed failures become the port's three; anything else is not ours to hide. */
function translated({ error }: { error: Error }): Error {
  if (error instanceof VersionConflictError || error instanceof EntrySlugConflictError) return new NoteEntityError({ code: 'CONFLICT', message: error.message });
  if (error instanceof EntryNotFoundError) return new NoteEntityError({ code: 'NOT_FOUND', message: error.message });
  if (error instanceof EntryFieldValidationError) return new NoteEntityError({ code: 'VALIDATION', message: error.message });
  return error;
}

function unwrapped<T>({ result }: { result: { ok: true; value: T } | { ok: false; error: Error } }): T {
  if (result.ok) return result.value;
  throw translated({ error: result.error });
}

/** Newest first; the id breaks ties so the keyset cursor (the last id) is stable. */
const newestFirst = (a: EntryRecord, b: EntryRecord): number => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1);

function pageOf({ rows, query }: { rows: readonly NoteRow[]; query: AdminEntityListQuery }): AdminEntityPage<AdminEntityRowData> {
  const start = query.cursor === undefined ? 0 : rows.findIndex((row) => row.id === query.cursor) + 1;
  if (query.cursor !== undefined && start === 0) throw new NoteEntityError({ code: 'VALIDATION', message: 'unknown cursor' });
  const items = rows.slice(start, query.limit === undefined ? undefined : start + query.limit);
  const last = items.at(-1);
  return { items, nextCursor: last !== undefined && start + items.length < rows.length ? last.id : null, total: rows.length };
}

const scopeOf = ({ deps }: { deps: NoteEntityDeps }) => ({ ...deps.actor, workspaceId: WORKSPACE_ID });
const bad = ({ message }: { message: string }): NoteEntityError => new NoteEntityError({ code: 'VALIDATION', message });

async function findNote({ deps, id }: { deps: NoteEntityDeps; id: string }): Promise<EntryRecord | null> {
  const entry = await deps.entryRepo.findById({ workspaceId: WORKSPACE_ID, id });
  return entry !== null && entry.type === NOTE_TYPE ? entry : null;
}

/** An explicit slug as given; otherwise the title's slug, with `-2`, `-3`... until it is free. */
async function freeSlug({ deps, title, slug }: { deps: NoteEntityDeps; title: string; slug: string | undefined }): Promise<string> {
  if (slug !== undefined) return slug;
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (await deps.entryRepo.findBySlug({ workspaceId: WORKSPACE_ID, type: NOTE_TYPE, slug: candidate }) === null) return candidate;
  }
}

async function moveTo({ deps, entry, status }: { deps: NoteEntityDeps; entry: EntryRecord; status: 'published' | 'unpublished' }): Promise<EntryRecord> {
  const run = status === 'published' ? publishEntry : unpublishEntry;
  return unwrapped({ result: await run({ deps: deps.entryDeps, input: { ...scopeOf({ deps }), id: entry.id, expectedVersion: entry.version } }) }).entry;
}

async function listNotes({ deps, query }: { deps: NoteEntityDeps; query: AdminEntityListQuery }): Promise<AdminEntityPage<AdminEntityRowData>> {
  if ((query.filter?.length ?? 0) > 0 || query.sort !== undefined) throw bad({ message: 'notes support search and paging only' });
  const { items } = await listEntries({ repo: deps.entryRepo, workspaceId: WORKSPACE_ID }, { type: NOTE_TYPE });
  const rows = [...items].sort(newestFirst).map((entry) => toRow({ entry }));
  return pageOf({ rows: filterNotesByText({ rows, text: query.search ?? '' }), query });
}

async function createNote({ deps, input }: { deps: NoteEntityDeps; input: unknown }): Promise<AdminEntityRowData> {
  const { title, body, slug, status } = readCreateInput({ input });
  const created = unwrapped({ result: await createEntry({ deps: { ...deps.entryDeps, ids: deps.ids }, input: {
    ...scopeOf({ deps }), type: NOTE_TYPE, slug: await freeSlug({ deps, title, slug }), title, fieldsJson: { ext: { site: {} } }, bodyJson: { text: body },
  } }) }).entry;
  return toRow({ entry: status === 'published' ? await moveTo({ deps, entry: created, status }) : created });
}

/** Title and body in one `updateEntry` at the caller's version; with neither, the entry is left as read. */
async function writeFields({ deps, stored, input }: { deps: NoteEntityDeps; stored: EntryRecord; input: NoteUpdateInput }): Promise<EntryRecord> {
  const { title, body, version } = input;
  if (title === undefined && body === undefined) return { ...stored, version };
  return unwrapped({ result: await updateEntry({ deps: deps.entryDeps, input: {
    ...scopeOf({ deps }), id: stored.id, expectedVersion: version, ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { bodyJson: { text: body } }),
  } }) }).entry;
}

/** Fields first, then the status move at the version that came back. */
async function updateNote({ deps, id, patch }: { deps: NoteEntityDeps; id: string; patch: unknown }): Promise<AdminEntityRowData> {
  const stored = await findNote({ deps, id });
  if (stored === null) throw new NoteEntityError({ code: 'NOT_FOUND', message: `no note has id '${id}'` });
  const input = readUpdateInput({ input: patch, storedSlug: stored.slug });
  const { status } = input;
  if (status === 'draft' && stored.status !== 'draft') throw bad({ message: 'a published note cannot go back to draft; unpublish it' });
  const current = await writeFields({ deps, stored, input });
  const move = status !== undefined && status !== 'draft' && status !== current.status;
  return toRow({ entry: move ? await moveTo({ deps, entry: current, status }) : current });
}

export function createNoteEntityPort({ deps }: { deps: NoteEntityDeps }, _optional: Record<string, never> = {}): AdminErasedEntityPort {
  return {
    descriptor: NOTE_DESCRIPTOR,
    list: (query = {}) => listNotes({ deps, query }),
    async get(id) {
      const entry = await findNote({ deps, id });
      return entry === null ? null : toRow({ entry });
    },
    create: (input) => createNote({ deps, input }),
    update: (id, patch) => updateNote({ deps, id, patch }),
  };
}
