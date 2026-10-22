/** Versioned text metadata echoed by supporting CLI clients; emission is host opt-in. */
export interface DelegatedResultMarker {
  readonly version: 1;
  readonly toolUseId: string;
}

/** Builds metadata beside the original MCP blocks; never accepts model-selected ownership. */
export function delegatedResultMarker({ toolUseId }: { toolUseId: string }, _options = {}): { type: 'text'; text: string } {
  return { type: 'text', text: JSON.stringify({ jiniDelegatedResult: { version: 1, toolUseId } }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function markerText(block: unknown): string | undefined {
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string' || block.text.length > 1024) return undefined;
  return block.text;
}

function markerId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

/** Parses only the exact v1 metadata shape. Untrusted metadata is a hint, never proof. */
function parseMarker(block: unknown): DelegatedResultMarker | undefined {
  const text = markerText(block);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || Object.keys(value).length !== 1) return undefined;
    const marker = value.jiniDelegatedResult;
    if (!isRecord(marker) || Object.keys(marker).length !== 2 || marker.version !== 1) return undefined;
    const toolUseId = markerId(marker.toolUseId);
    return toolUseId === undefined ? undefined : { version: 1, toolUseId };
  } catch {
    return undefined;
  }
}

/** Reads one leading marker without altering the original content. Ambiguous markers fall back.
 * @complexity O(n) blocks; metadata parsing is bounded to 1024 characters per block. */
export function readDelegatedResult({ content }: { content: unknown }, _options = {}): { marker: DelegatedResultMarker; content: readonly unknown[] } | undefined {
  if (!Array.isArray(content)) return undefined;
  const marker = parseMarker(content[0]);
  if (!marker || content.slice(1).some(block => parseMarker(block) !== undefined)) return undefined;
  return { marker, content: content.slice(1) };
}
