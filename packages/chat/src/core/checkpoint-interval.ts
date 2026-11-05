/**
 * Select the checkpoint delay for an approximate saved-projection size.
 * @param required.bytes Approximate payload size in bytes; thresholds use decimal MB.
 * @returns 1 s below 1 MB, 3 s from 1 MB, and 10 s from 5 MB. Pure; no side effects.
 * @complexity O(1) time and space.
 */
export function checkpointIntervalMs({ bytes }: { bytes: number }, _options = {}): number {
  if (bytes >= 5_000_000) return 10_000;
  if (bytes >= 1_000_000) return 3_000;
  return 1_000;
}


/** Count durable progress without materializing the saved projection. Thinking and extension
 * receipts must survive a crash even before the next answer/tool. Status chatter and duplicate
 * tool echoes must not trigger another multi-MB compaction.
 * @param required.events Current renderable projection; never mutated.
 * @returns Text/thinking characters, extension count and unique tool identities.
 * @complexity O(events) time and O(unique tool identities) space.
 * @example checkpointProgress({ events: [{ kind: 'thinking', text: 'Working' }] });
 */
export function checkpointProgress({ events }: { events: readonly import('./events.js').AgentEvent[] }, _options = {}): {
  textCharacters: number; extensionEvents: number; tools: Set<string>;
} {
  let textCharacters = 0;
  let extensionEvents = 0;
  const tools = new Set<string>();
  for (const event of events) {
    if (event.kind === 'text' || event.kind === 'thinking') textCharacters += event.text.length;
    if (event.kind === 'ext') extensionEvents++;
    if (event.kind === 'tool_use') tools.add(`tool_use:${event.id}`);
    if (event.kind === 'tool_result') tools.add(`tool_result:${event.toolUseId}`);
  }
  return { textCharacters, extensionEvents, tools };
}
