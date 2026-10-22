import { useMemo } from 'react';
import { stripConversationTitleMarkdown } from '../../core/persistence/title.js';
import type { ConversationListItem } from './ConversationList.js';

/** Project saved/search titles for presentation without renaming durable conversations.
 * The switcher has no prompt or title provenance, so keep wording and casing while stripping
 * markup through the same owner as the panel title. Caller arrays and objects stay untouched.
 * @param input.conversations - The loaded conversations.
 * @param input.serverResults - Optional server search results, or null before a response.
 * @returns Plain-text display lists and raw titles for lossless editing. Hosts ellipsize rows in CSS.
 * @complexity O(n + sum(t²)) worst-case cleanup time; O(n + sum(t)) space for n items of length t.
 */
export function useConversationListTitles({ conversations, serverResults }: {
  conversations: ConversationListItem[]; serverResults: ConversationListItem[] | null;
}, _options = {}): {
  conversations: ConversationListItem[]; serverResults: ConversationListItem[] | null;
  rawTitles: ReadonlyMap<string, string | null>;
} {
  return useMemo(() => {
    const rawTitles = new Map<string, string | null>();
    const display = (items: ConversationListItem[]) => items.map(item => ({
      ...item, title: item.title === null ? null : stripConversationTitleMarkdown({ text: item.title }) || null,
    }));
    // Search results can contain unloaded rows or newer titles for loaded ids; visible results win.
    for (const item of conversations) rawTitles.set(item.id, item.title);
    for (const item of serverResults ?? []) rawTitles.set(item.id, item.title);
    return { conversations: display(conversations), serverResults: serverResults === null ? null : display(serverResults), rawTitles };
  }, [conversations, serverResults]);
}
