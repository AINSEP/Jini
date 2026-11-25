/**
 * @file The bundled `word-count` plugin's pure tokenizer (SPEC-005 REQ-09; RT-005 pinned tokenization).
 * The plugin's manifest, SDK binding and source location stay with the host that bundles it; only this
 * I/O-free count lives here.
 *
 * REQ-09's pinned tokenization algorithm (RT-005): concatenate all `text`-node string values in
 * `bodyJson` (depth-first) with single spaces, trim, split on `/\s+/`, count non-empty tokens.
 */

/**
 * REQ-09's pinned algorithm: walk `bodyJson` depth-first collecting every `text`-node string
 * value (TipTap-shaped document tree: `{ type, text?, content?: [...] }`), join with single
 * spaces, trim, split on `/\s+/`, count non-empty tokens. Pure — no I/O.
 *
 * @param required.bodyJson - The entry's TipTap-shaped document (`ContentEntryDraft.bodyJson`).
 * @returns The non-empty whitespace-delimited token count of every text node's concatenated value.
 * @complexity O(n) over the document's total node count.
 */
export function countWords({ bodyJson }: { bodyJson: unknown }, _optional = {}): number {
  const texts: string[] = [];

  // Depth-first walk. Every node's own `text` is collected before its `content` children are
  // visited, so the collected order is document order. Non-object nodes, nodes without `text`,
  // and nodes without `content` are all simply skipped — never an error (RT-005: an image node
  // contributes nothing rather than throwing).
  const visit = ({ node }: { node: unknown }, _optional = {}): void => {
    if (typeof node !== "object" || node === null) return;

    if (Array.isArray(node)) {
      for (const child of node) visit({ node: child });
      return;
    }

    const { text, content } = node as { text?: unknown; content?: unknown };
    if (typeof text === "string") texts.push(text);
    if (Array.isArray(content)) {
      for (const child of content) visit({ node: child });
    }
  };

  visit({ node: bodyJson });

  // RT-005's literal wording: join EVERY collected text-node value with single spaces (not only
  // the ones separated by a block boundary), trim, split on `/\s+/`, count non-empty tokens.
  const joined = texts.join(" ").trim();
  if (joined === "") return 0;
  return joined.split(/\s+/).filter((token) => token !== "").length;
}
