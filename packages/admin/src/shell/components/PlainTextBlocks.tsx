import { Fragment } from "react";

import { toPlainTextBlocks } from "../lib/plain-text-blocks.js";

/**
 * Author prose with its paragraphs, line breaks and `- ` bullets kept (see `toPlainTextBlocks`).
 * The one renderer for plugin and skill descriptions, so every place that shows one breaks it the
 * same way. Renders nothing for empty text.
 */
export function PlainTextBlocks({ text, className }: { text: string | null | undefined; className?: string }) {
  const blocks = toPlainTextBlocks({ text });
  if (blocks.length === 0) return null;
  return (
    <div className={className}>
      {blocks.map((block, index) =>
        block.kind === "list" ? (
          <ul key={index}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
