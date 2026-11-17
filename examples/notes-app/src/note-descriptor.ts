/** @file What the admin entity screens know about a note, and the one error the note port throws. */
import type { AdminEntityDescriptor } from '@jini-ai/admin/core';

export const NOTE_STATUSES = ['draft', 'published', 'unpublished'] as const;

/**
 * `slug` and `version` are `persistedOnly`: generated and read-only once saved, never asked for on create
 * (a person is never asked for a concurrency token). `version` travels back unchanged in every update:
 * it is the `expectedVersion` the entry service compares. `updatedAt` is shown read-only.
 */
export const NOTE_DESCRIPTOR = {
  name: 'note',
  labelSingular: 'Note',
  labelPlural: 'Notes',
  titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true, queryable: true },
    { name: 'slug', kind: 'text', required: true, persistedOnly: true },
    { name: 'body', kind: 'text' },
    { name: 'status', kind: 'text', required: true },
    { name: 'version', kind: 'integer', required: true, persistedOnly: true },
    { name: 'updatedAt', kind: 'datetime', required: true, persistedOnly: true },
  ],
} as const satisfies AdminEntityDescriptor;

export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** A client mistake the HTTP layer answers with 400 (VALIDATION), 404 (NOT_FOUND) or 409 (CONFLICT). */
export class NoteEntityError extends Error {
  readonly code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT';

  constructor({ code, message }: { code: NoteEntityError['code']; message: string }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = 'NoteEntityError';
    this.code = code;
  }
}
