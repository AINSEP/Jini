/**
 * Origin: `apps/web/src/components/composer/deserialize.ts`. Ported
 * verbatim, except `buildInlineMentionParts` → `parseMentionParts` (this
 * package's generalized mention parser, see `mention-parser.ts`).
 */
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { $createMentionNode } from './mention-node.js';
import { parseMentionParts } from './mention-parser.js';
import type { MentionEntity } from './types.js';

// Rebuild the whole editor from a plain `@token` string. Known `@token`
// runs (matched against `knownMentions`) become atomic mention nodes;
// everything else is plain text. Newlines map to LineBreakNodes inside a
// single paragraph so serialization round-trips to a single `\n`. Caret is
// placed at the end inside the same update so post-seed typing keeps the
// caret.
export function setRichTextFromPlainText(
  editor: LexicalEditor,
  text: string,
  knownMentions: MentionEntity[],
): void {
  // `discrete: true` commits the update synchronously. This matters both for
  // tests reading the state back on the next line AND for a host's
  // setText/clear → onChange round-trip, where a deferred update could let a
  // stale serialize slip through before the rebuild lands. On a mounted
  // editor it behaves like a normal update (just flushed immediately).
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) p.append($createLineBreakNode());
        if (!line) return;
        const parts = parseMentionParts(line, knownMentions, { highlightUnknown: false });
        if (!parts) {
          p.append($createTextNode(line));
          return;
        }
        for (const part of parts) {
          if (part.kind === 'mention' && part.entity.kind !== 'unknown') {
            p.append(
              $createMentionNode({
                mentionId: part.entity.id,
                mentionKind: part.entity.kind,
                token: part.text,
                label: part.entity.label,
                title: part.entity.title,
              }),
            );
          } else if (part.text) {
            p.append($createTextNode(part.text));
          }
        }
      });
      root.append(p);
      p.selectEnd();
    },
    { discrete: true },
  );
}
