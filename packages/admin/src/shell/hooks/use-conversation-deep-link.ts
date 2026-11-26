/**
 * @file The dock half of "Open conversation": applies `?conversation=<id>` by selecting an EXISTING
 * conversation the signed-in owner can already list. Why: a link must never create a conversation,
 * send a message or start a run, so admission is the owner-scoped list read (not `select`, which
 * returns void), a transient fetch error is not proof the conversation is gone, and a missing one
 * clears only `conversation` from the URL (keeping `tab`) with a plain notice.
 */
import { useEffect, useRef } from "react";

export const CONVERSATION_GONE_KEY = "This conversation is no longer available." as const;

export type DeepLinkChats = Readonly<{ select: (required: { id: string }, optional?: Record<string, never>) => void }>;
export type DeepLinkPorts = Readonly<{
  /** Resolves true/false for an owner-visible conversation; REJECTS on a transient failure (never treated as absence). */
  lookupConversation: (required: { id: string }) => Promise<boolean>;
  replaceQuery: (required: { query: URLSearchParams }) => void;
  notify: (required: { key: typeof CONVERSATION_GONE_KEY }) => void;
  openDock: () => void;
}>;

export function useApplyConversationDeepLink({ query, chats, lookupConversation, replaceQuery, notify, openDock, principalId }: DeepLinkPorts & {
  query: URLSearchParams | null; chats: DeepLinkChats; principalId: string;
}, _optional: Record<string, never> = {}): void {
  const conversationId = query?.get("conversation") ?? null;
  // Latest ports without re-running the effect on every render: only the id or principal restarts a lookup.
  const latest = useRef({ query, chats, lookupConversation, replaceQuery, notify, openDock });
  latest.current = { query, chats, lookupConversation, replaceQuery, notify, openDock };
  useEffect(() => {
    if (conversationId === null || conversationId === "" || principalId === "") return undefined;
    let current = true; // fences a lookup that resolves after the link or principal changed
    void (async () => {
      const ports = latest.current;
      let found: boolean;
      try { found = await ports.lookupConversation({ id: conversationId }); } catch { return; }
      if (!current) return;
      if (found) { ports.openDock(); latest.current.chats.select({ id: conversationId }, {}); return; }
      const next = new URLSearchParams(ports.query ?? undefined);
      next.delete("conversation");
      ports.notify({ key: CONVERSATION_GONE_KEY });
      ports.replaceQuery({ query: next });
    })();
    return () => { current = false; };
  }, [conversationId, principalId]);
}
