import { useEffect } from "react";

import {
  publishAgentScreenEntry,
  publishAgentScreenRoute,
  type AgentScreenEntry,
  type AgentScreenRoute,
} from "../lib/agent-screen-context.js";

/**
 * Publishes the operator's current route for the assistant (`lib/agent-screen-context.ts`) while the
 * caller is mounted. Called once, from `App.tsx`.
 *
 * Effect deps are the three primitives, not the object, so a caller building the object inline does
 * not republish on every render.
 */
export function useAgentScreenRoute({ path, section, view }: AgentScreenRoute): void {
  useEffect(() => publishAgentScreenRoute({ path, section, view }), [path, section, view]);
}

/**
 * Publishes the entry an editor has open (`lib/agent-screen-context.ts`) while the editor is mounted,
 * and clears it on unmount so a list screen never reports the entry the operator just left.
 *
 * @param required.entry - The loaded entry, or `null` while it is still loading (or failed to load) — nothing
 *   is published then, so the assistant is told the section without a guessed entry.
 */
export function useAgentScreenEntry({ entry }: { entry: AgentScreenEntry | null }, _options = {}): void {
  const kind = entry?.kind;
  const id = entry?.id;
  const title = entry?.title;
  const slug = entry?.slug;
  const status = entry?.status;
  useEffect(() => {
    if (kind === undefined || id === undefined || title === undefined) return undefined;
    return publishAgentScreenEntry({
      kind,
      id,
      title,
      ...(slug === undefined ? {} : { slug }),
      ...(status === undefined ? {} : { status }),
    });
  }, [kind, id, title, slug, status]);
}
