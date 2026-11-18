/** @file Reads the untrusted objects a screen or client sends to the note port into checked values. */
import { NOTE_STATUSES, NoteEntityError, type NoteStatus } from './note-descriptor.ts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const invalid = ({ message }: { message: string }): NoteEntityError => new NoteEntityError({ code: 'VALIDATION', message });

export interface NoteCreateInput { title: string; body: string; slug: string | undefined; status: NoteStatus }
export interface NoteUpdateInput { title?: string; body?: string; status?: NoteStatus; version: number }

function optionalString({ input, key }: { input: Record<string, unknown>; key: string }): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid({ message: `${key} must be text` });
  return value;
}

function readStatus({ input }: { input: Record<string, unknown> }): NoteStatus | undefined {
  const status = optionalString({ input, key: 'status' });
  if (status === undefined) return undefined;
  if (!(NOTE_STATUSES as readonly string[]).includes(status)) throw invalid({ message: `status must be one of ${NOTE_STATUSES.join(', ')}` });
  return status as NoteStatus;
}

function readTitle({ input, required }: { input: Record<string, unknown>; required: boolean }): string | undefined {
  const title = optionalString({ input, key: 'title' });
  if (title === undefined && !required) return undefined;
  if (title === undefined || title.trim() === '') throw invalid({ message: 'title is required' });
  return title;
}

export function assertObject({ input }: { input: unknown }): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid({ message: 'expected an object' });
  return input as Record<string, unknown>;
}

export function readCreateInput({ input }: { input: unknown }): NoteCreateInput {
  const fields = assertObject({ input });
  const slug = optionalString({ input: fields, key: 'slug' });
  if (slug !== undefined && !SLUG.test(slug)) throw invalid({ message: 'slug may only hold lower-case letters, digits and single hyphens' });
  const status = readStatus({ input: fields }) ?? 'draft';
  if (status === 'unpublished') throw invalid({ message: 'a new note cannot start as unpublished' });
  return { title: readTitle({ input: fields, required: true }) as string, body: optionalString({ input: fields, key: 'body' }) ?? '', slug, status };
}

/** `slug` and `updatedAt` are read-only: sent back unchanged they are ignored, a different slug is refused. */
export function readUpdateInput({ input, storedSlug }: { input: unknown; storedSlug: string }): NoteUpdateInput {
  const fields = assertObject({ input });
  const { version } = fields;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw invalid({ message: 'version is required: the version you read' });
  const slug = optionalString({ input: fields, key: 'slug' });
  if (slug !== undefined && slug !== storedSlug) throw invalid({ message: 'the slug cannot be changed after the note is created' });
  const title = readTitle({ input: fields, required: false });
  const body = optionalString({ input: fields, key: 'body' });
  const status = readStatus({ input: fields });
  return { version, ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }), ...(status === undefined ? {} : { status }) };
}
