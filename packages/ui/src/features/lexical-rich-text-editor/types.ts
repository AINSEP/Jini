/** PlainTextPlugin-backed editing with atomic mentions, rather than block/mark rich text.
 * Mention colors are host-injected through resolveMentionColor; generic trigger/navigation/caret
 * and wire serialization rules stay independent of a product's connector branding. */

/** A single mention-able entity: any host-owned capability/entity with a
 *  stable id, a display label, and a free-form category ("kind"). Unlike
 *  the origin's fixed `plugin | skill | mcp | file | workspace | connector`
 *  union, `kind` is a plain string so a host can define its own vocabulary. */
export interface MentionEntity {
  id: string;
  kind: string;
  /** Literal `@token` text this entity renders as (e.g. `"@Slack"`). */
  token?: string | undefined;
  label: string;
  title?: string | undefined;
}

export type MentionPart =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; entity: MentionEntity; text: string };

/** One `@token` to insert into the editor via the imperative handle. */
export interface MentionInsert {
  token: string;
  entity: MentionEntity;
}

/** A serializable caret box the host portal positions against. Viewport-space
 *  (`getBoundingClientRect`), matching a `position: fixed` portal's space. */
export interface CaretRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** How a trigger character is recognized at the caret:
 *  - `'inline'` — anywhere the character is preceded by start-of-line or
 *    whitespace (the origin's `@mention` rule).
 *  - `'line-start'` — only when the trigger + query is the entire line so
 *    far (the origin's `/slash`-command rule). */
export type RichTextTriggerAnchor = 'inline' | 'line-start';

export interface RichTextTriggerConfig {
  /** Host-chosen identifier reported back in `RichTextTriggerMatch.id`. */
  id: string;
  character: string;
  anchor: RichTextTriggerAnchor;
}

/** The currently active trigger at the caret, or `null` when none is live. */
export interface RichTextTriggerMatch {
  id: string;
  /** Text typed after the trigger character so far. */
  query: string;
  anchorRect: CaretRect | null;
}

export type PopoverNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Tab' | 'Enter' | 'Escape';

export interface SerializedRichText {
  text: string;
  /** Entities backed by an actual mention node currently in the tree. */
  mentions: MentionEntity[];
}

export interface RichTextInputHandle {
  getText(): string;
  setText(text: string): void;
  clear(): void;
  focus(): void;
  insertText(text: string): void;
  insertMention(insert: MentionInsert): void;
  /** Drops the in-flight trigger token at the caret (e.g. `"@quer"`) and
   *  inserts `text` in its place. */
  replaceActiveTrigger(text: string): void;
}
