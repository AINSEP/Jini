'use client';

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { MentionNode } from '../../mention-node.js';
import { $collectMentionNodeKeys } from '../../rules.js';
import type { MentionEntity } from '../../types.js';

/** The CSS custom property a host's `resolveMentionColor` result is applied
 *  to. A host's CSS reads it directly (e.g.
 *  `color: var(--rich-text-mention-color, currentColor)`) — this hook never
 *  writes any other style. */
export const MENTION_COLOR_PROPERTY = '--rich-text-mention-color';

/**
 * Replaces the origin's OD-specific brand-hue logic
 * (`connectorBrandColor`/`resolveBrandTheme`, applied via a document-wide
 * `MutationObserver` watching every mounted `.composer-inline-mention` pill
 * on the page). This is scoped to ONE editor instance via Lexical's own
 * `registerMutationListener`, and the color itself is fully host-owned: a
 * `resolveMentionColor` callback the host can recompute from its own theme
 * state (a new function identity re-runs the restamp pass below, no global
 * observer required).
 */
export function useMentionColorStamping(
  resolveMentionColor?: ((mention: MentionEntity) => string | undefined) | undefined,
): void {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!resolveMentionColor) return;

    const stampByKey = (key: string): void => {
      const dom = editor.getElementByKey(key);
      if (!dom) return;
      // Both call sites below hand `stampByKey` a key already guaranteed to
      // resolve to a `MentionNode`: `$collectMentionNodeKeys()` only ever
      // collects mention-node keys, and `registerMutationListener(MentionNode,
      // ...)` only ever reports keys of that type (a 'destroyed' mutation —
      // the one case where the node no longer exists — is filtered out by
      // the caller before this runs). The cast documents that guarantee
      // instead of adding an `$isMentionNode` branch neither call site can
      // actually fail.
      const node = $getNodeByKey(key) as MentionNode;
      const color = resolveMentionColor(node.getEntity());
      if (color) dom.style.setProperty(MENTION_COLOR_PROPERTY, color);
      else dom.style.removeProperty(MENTION_COLOR_PROPERTY);
    };

    // Initial pass: restamp every mention node already mounted before this
    // effect's `resolveMentionColor` identity took effect (e.g. the host
    // just switched themes and passed a new resolver).
    editor.getEditorState().read(() => {
      for (const key of $collectMentionNodeKeys()) stampByKey(key);
    });

    return editor.registerMutationListener(MentionNode, (mutatedNodes) => {
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutatedNodes) {
          if (mutation === 'destroyed') continue;
          stampByKey(key);
        }
      });
    });
  }, [editor, resolveMentionColor]);
}
