import type { ToolDescriptor } from '@jini-ai/core';

/** Bounded Levenshtein distance for diagnostic ranking; oversized names retain prefix discovery.
 * @returns Edit count, or Infinity above the 128-character scoring limit (no effects).
 * @complexity O(l*r) time and O(r) space, with both name lengths capped at 128.
 */
function nameDistance({ left, right }: { left: string; right: string }, _options: Record<string, never> = {}): number {
  if (left.length > 128 || right.length > 128) return Infinity;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1,
        previous[column - 1]! + Number(left[row - 1] !== right[column - 1]));
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** Registered prefix/near-name suggestions, closest first and capped at eight. Equal scores keep
 * catalog order. `target` is the spelling the caller wants ranked against instead of `toolId` (a host that
 * knows which member a request selected passes it); an exact registered `target` takes priority even beyond
 * the cutoff, and prefix matching still uses `toolId`. This function knows no host tool names and reads no input.
 * Suggestions grant no execution authority; the caller must retry through the existing gates.
 * @example toolCandidates({ toolId: 'fam', target: 'fam.theme', tools });
 * @complexity O(n*l*r + n log n) time, O(n + r) space; scoring lengths capped at 128.
 */
export function toolCandidates(
  { toolId, tools, target = toolId }: { toolId: string; tools: readonly Pick<ToolDescriptor, 'id'>[]; target?: string },
  _optional: Record<string, never> = {},
): string[] {
  return tools.map(({ id }) => ({ id, distance: nameDistance({ left: target, right: id }) }))
    .filter(({ id, distance }) => id === target || id.startsWith(toolId) || distance <= 2)
    .sort((left, right) => Number(right.id === target) - Number(left.id === target) || left.distance - right.distance)
    .slice(0, 8).map(({ id }) => id);
}
