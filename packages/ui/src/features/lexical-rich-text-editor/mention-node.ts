/**
 * The atomic `@mention` node. Extends `TextNode` so the node's *text* remains
 * the literal `@token` and serialization back to the wire format is free:
 * `getTextContent()` already yields `@token`. Lexical token mode deletes the
 * node as one entity but still allows character-by-character caret
 * navigation, so `rules.ts` adds explicit keyboard normalization for arrows.
 *
 * Origin: `apps/web/src/components/composer/MentionNode.ts`. The origin
 * imported OD's `connectorBrandColor`/`resolveBrandTheme` directly to color
 * a `connector`-kind pill's `--m-hue` CSS custom property, and installed a
 * document-wide `MutationObserver` to re-stamp every mounted pill on a live
 * theme flip. Both are dropped from this node entirely — no per-instance
 * color logic and no global observer belong on a generic Lexical node class.
 * A host that wants per-kind/per-entity coloring supplies a
 * `resolveMentionColor` callback to `RichTextInput`, applied by
 * `react/hooks/useMentionColorStamping.ts` via Lexical's own
 * `registerMutationListener` (scoped to that one editor instance, not the
 * whole document) — see that file for the replacement mechanism.
 */
import {
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical';
import type { MentionEntity } from './types.js';

export interface MentionPayload {
  mentionId: string;
  mentionKind: string;
  /** Literal `"@token"` — this IS the node text. */
  token: string;
  label: string;
  title?: string | undefined;
}

export type SerializedMentionNode = Spread<
  {
    mentionId: string;
    mentionKind: string;
    token: string;
    label: string;
    title?: string;
  },
  SerializedTextNode
>;

export class MentionNode extends TextNode {
  __mentionId: string;
  __mentionKind: string;
  __token: string;
  __label: string;
  __title: string | undefined;

  static getType(): string {
    return 'rich-text-mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(
      {
        mentionId: node.__mentionId,
        mentionKind: node.__mentionKind,
        token: node.__token,
        label: node.__label,
        title: node.__title,
      },
      node.__text,
      node.__key,
    );
  }

  constructor(p: MentionPayload, text?: string, key?: NodeKey) {
    super(text ?? p.token, key); // node TEXT = token → serializes verbatim
    this.__mentionId = p.mentionId;
    this.__mentionKind = p.mentionKind;
    this.__token = p.token;
    this.__label = p.label;
    this.__title = p.title;
    // NOTE: token mode is applied in $createMentionNode, NOT here. Calling
    // this.setMode('token') in the constructor recurses to a stack overflow:
    // setMode → getWritable → (for an existing node) clone() → new
    // MentionNode → setMode → … Lexical's clone protocol copies `__mode`
    // from the previous node in `TextNode.afterCloneFrom`, so clones
    // preserve token mode without re-running setMode.
  }

  getEntity(): MentionEntity {
    return {
      id: this.__mentionId,
      kind: this.__mentionKind,
      label: this.__label,
      token: this.__token,
      ...(this.__title ? { title: this.__title } : {}),
    };
  }

  getToken(): string {
    return this.__token;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config); // <span> wrapping the token text
    dom.className = `rich-text-mention rich-text-mention--${this.__mentionKind}`;
    dom.contentEditable = 'false';
    dom.setAttribute('contenteditable', 'false');
    dom.setAttribute('data-mention', '');
    dom.setAttribute('data-mention-id', this.__mentionId);
    dom.setAttribute('data-mention-kind', this.__mentionKind);
    dom.setAttribute('data-mention-label', this.__label);
    if (this.__title) dom.setAttribute('title', this.__title);
    return dom;
  }

  updateDOM(prev: this, dom: HTMLElement, config: EditorConfig): boolean {
    // `TextNode.updateDOM` declares its previous-node param with a polymorphic
    // `this`. Match that signature exactly so the override is type-compatible;
    // inside MentionNode `this` is MentionNode, so the `__mention*` reads below
    // are still well typed.
    const updated = super.updateDOM(prev, dom, config);
    if (prev.__mentionKind !== this.__mentionKind) {
      dom.className = `rich-text-mention rich-text-mention--${this.__mentionKind}`;
      dom.setAttribute('data-mention-kind', this.__mentionKind);
    }
    if (prev.__label !== this.__label) {
      dom.setAttribute('data-mention-label', this.__label);
    }
    if (prev.__mentionId !== this.__mentionId) {
      dom.setAttribute('data-mention-id', this.__mentionId);
    }
    if (prev.__title !== this.__title) {
      if (this.__title) dom.setAttribute('title', this.__title);
      else dom.removeAttribute('title');
    }
    return updated;
  }

  // Token mode keeps the mention indivisible. Text must still be insertable on
  // either side as sibling text nodes so users can click/arrow around a pill
  // and continue writing inline.
  isToken(): true {
    return true;
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      type: MentionNode.getType(),
      version: 1,
      mentionId: this.__mentionId,
      mentionKind: this.__mentionKind,
      token: this.__token,
      label: this.__label,
      ...(this.__title ? { title: this.__title } : {}),
    };
  }

  static importJSON(json: SerializedMentionNode): MentionNode {
    return $createMentionNode({
      mentionId: json.mentionId,
      mentionKind: json.mentionKind,
      token: json.token,
      label: json.label,
      title: json.title,
    });
  }
}

export function $createMentionNode(p: MentionPayload): MentionNode {
  // setMode here (on a freshly-created node, before it is cloned) is safe:
  // getWritable returns the node itself, so there is no clone recursion. All
  // later clones inherit the mode via TextNode.afterCloneFrom. Keep token
  // mode out of the constructor (see the note there).
  const node = new MentionNode(p);
  node.setMode('token'); // atomic: single caret stop, whole-node delete
  return node;
}

export function $isMentionNode(n: LexicalNode | null | undefined): n is MentionNode {
  return n instanceof MentionNode;
}
