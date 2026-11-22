import { trimChars } from "@jini-ai/core/primitives";

/** Lower-cased ASCII letters and digits, every other run of characters collapsed to one `-`, with
 *  no leading or trailing `-`. Empty when the text has no ASCII letter or digit. */
export function asciiSlug({ text }: { text: string }, _optional: Record<string, never> = {}): string {
  return trimChars({ text: text.toLowerCase().replace(/[^a-z0-9]+/g, "-"), chars: "-" });
}
