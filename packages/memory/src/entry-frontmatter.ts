import { splitLabeledLine } from './text-scan.js';

/** The frontmatter keys an entry carries. */
const FRONTMATTER_KEY = /^(?:name|description|type)$/;
/**
 * @module entry-frontmatter
 *
 * Minimal frontmatter read/write for exactly the three flat scalar fields a
 * note-store entry needs (`name`/`description`/`type`) plus a markdown body.
 * Deliberately not a general YAML-subset parser (OD's `design-systems/
 * frontmatter.ts`, which handles nested objects/arrays/block-literals, was
 * out of scope for this port — a different subsystem, not part of this
 * task's brief) — this only needs to round-trip the note entry file shape:
 *
 * ```
 * ---
 * name: <value>
 * description: <value>
 * type: <value>
 * ---
 *
 * <body>
 * ```
 */
export interface EntryFrontmatter {
  name: string;
  description: string;
  type: string;
}

/**
 * Parse an entry file's `---`-delimited frontmatter block plus body. Missing
 * or malformed frontmatter yields empty string fields, never a thrown error.
 *
 * @param raw - The full file contents.
 * @returns The parsed frontmatter fields and the body with the block removed.
 */
export function parseEntryFrontmatter({ raw }: { raw: string }): { data: EntryFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: { name: '', description: '', type: '' }, body: raw };
  // Both capture groups are `*`-quantified (zero-or-more), so a successful
  // match always populates them (as `''` at the empty extreme) — the
  // non-null assertions are TS-required, not a real runtime possibility.
  const yaml = match[1]!;
  const body = match[2]!;
  const data: EntryFrontmatter = { name: '', description: '', type: '' };
  for (const line of yaml.split(/\r?\n/)) {
    const kv = splitLabeledLine({ line, label: FRONTMATTER_KEY });
    if (!kv) continue;
    data[kv.label as keyof EntryFrontmatter] = kv.value.trim();
  }
  return { data, body };
}

/**
 * Render an entry file: the three frontmatter fields (single-line-sanitized)
 * followed by the trimmed-leading-whitespace body, ending with a newline.
 *
 * @param fields - The frontmatter fields to write.
 * @param body - The markdown body.
 * @returns The full file contents, ready to write to disk.
 */
export function renderEntryFrontmatter({ fields, body }: { fields: EntryFrontmatter; body: string }, _optional: Record<string, never> = {}): string {
  const safeName = fields.name.replace(/\r?\n/g, ' ').trim();
  const safeDescription = fields.description.replace(/\r?\n/g, ' ').trim();
  const safeType = fields.type.replace(/\r?\n/g, ' ').trim();
  const trimmedBody = body.replace(/^\s+/, '');
  // Metadata-only edits feed the stored body back here; keep its existing
  // newline rather than growing it on each render. Markdown spaces stay intact.
  const ending = trimmedBody.endsWith('\n') ? '' : '\n';
  return `---\nname: ${safeName}\ndescription: ${safeDescription}\ntype: ${safeType}\n---\n\n${trimmedBody}${ending}`;
}
