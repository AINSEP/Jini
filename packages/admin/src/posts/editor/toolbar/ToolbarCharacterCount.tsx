import { type Translate } from "@jini-ai/core/text";

/** What the readout needs from the host editor's toolbar state: the live character count. */
export interface ToolbarCharacterCountProps {
  state: { characterCount: number };
  t: Translate;
}

/* CharacterCount (owner, 2026-08-11: "anything and everything") — a plain readout, not a
    button: nothing to click, just the live count `editor.storage.characterCount` already
    tracks. Right-aligned via `margin-left: auto` (host stylesheet) so it reads as status text
    trailing the row rather than one more control competing with the buttons before it. */
export function ToolbarCharacterCount({ state: s, t }: ToolbarCharacterCountProps) {
  return (
    <span className="jini-post-toolbar__count" aria-live="polite">
      {s.characterCount} {s.characterCount === 1 ? t("character") : t("characters")}
    </span>
  );
}
