import { splitMiddleTruncation } from "./MiddleTruncate.rules.js";

export interface MiddleTruncateProps {
  /** The full text, e.g. a file name. */
  text: string;
  /** Stem characters kept beside the extension; see `splitMiddleTruncation`. */
  keepChars?: number | undefined;
  className?: string | undefined;
}

/**
 * One line of text that ellipsizes in the middle, keeping the end (a file's extension) visible.
 * The two halves are separate boxes, so a screen reader may read them as two pieces: name the
 * enclosing control with the full text (`aria-label`) rather than relying on this content.
 */
export function MiddleTruncate({ text, keepChars, className }: MiddleTruncateProps) {
  const { head, tail } = splitMiddleTruncation({ text }, keepChars === undefined ? {} : { keepChars });
  return (
    <span className={className ? `jini-middle-truncate ${className}` : "jini-middle-truncate"}>
      <span className="jini-middle-truncate__head">{head}</span>
      {tail ? <span className="jini-middle-truncate__tail">{tail}</span> : null}
    </span>
  );
}
