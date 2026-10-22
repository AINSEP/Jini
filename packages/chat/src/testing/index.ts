import type { ChatMessage } from '../core/index.js';

/** `turns` user/assistant pairs; each reply carries `toolRowsPerTurn` finished Bash calls with output. */
export function createLongTranscriptFixture(
  { turns, toolRowsPerTurn }: { turns: number; toolRowsPerTurn: number },
  _options: Record<string, never> = {},
): ChatMessage[] {
  return Array.from({ length: turns }, (_, turn): ChatMessage[] => [
    { id: `u${turn}`, role: 'user', content: `Step ${turn}`, createdAt: turn * 2 },
    {
      id: `a${turn}`,
      role: 'assistant',
      content: `Done with step ${turn}.`,
      runStatus: 'succeeded',
      createdAt: turn * 2 + 1,
      events: [
        ...Array.from({ length: toolRowsPerTurn }, (_, i) => [
          { kind: 'tool_use' as const, id: `t${turn}-${i}`, name: 'Bash', input: { command: `ls ${i}` } },
          { kind: 'tool_result' as const, toolUseId: `t${turn}-${i}`, content: 'file\n'.repeat(50), isError: false },
        ]).flat(),
        { kind: 'text' as const, text: `Done with step ${turn}.` },
        { kind: 'ext' as const, name: 'render-probe', data: { turn } },
      ],
    },
  ]).flat();
}
