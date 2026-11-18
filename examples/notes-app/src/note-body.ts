/** @file The note body shape the app stores in an entry's `bodyJson`: `{ text }`. */
import type { EntryRecord } from '@jini-ai/cms/entries';

/** Reads the plain-text body of a note, `''` when the entry has none. */
export const noteBody = ({ entry }: { entry: EntryRecord }, _optional: Record<string, never> = {}): string => {
  const body = entry.bodyJson as { text?: unknown } | null;
  return typeof body?.text === 'string' ? body.text : '';
};
