import type { SecretRedactionSignal } from "../../react/kit.js";

/** Values stay out of this callback. Reuse the one pending secure card instead of opening a twin. */
export function guideToPendingCredentialCard(
  { document }: { document: Pick<Document, "querySelectorAll"> }, _optional = {},
): boolean {
  // Pending MCP-UI cards whose element id names a secret card; the attribute substring selector is
  // the same test as `/secret-card/` on `data-agent-element`, without a separate filter pass.
  const cards = document.querySelectorAll<HTMLElement>('[data-agent-element^="mcp-ui-pending-"][data-agent-element*="secret-card"]');
  const only = cards[0];
  if (cards.length !== 1 || only === undefined) return false;
  const card = only.closest<HTMLElement>(".mcpui-surface-overflow-wrap") ?? only;
  card.scrollIntoView?.({ block: "center", behavior: "smooth" });
  card.querySelector<HTMLIFrameElement>("iframe")?.focus();
  return true;
}

/** With no unique pending card, [token removed] and the system credential rule request a new card.
 *  `document` defaults to the page's; `null` stands for a host with no DOM (nothing to guide to). */
export function onAdminSecretRedacted(
  _signal: SecretRedactionSignal,
  { document = globalThis.document }: { document?: Pick<Document, "querySelectorAll"> | null } = {},
): void {
  if (document) guideToPendingCredentialCard({ document }, {});
}
