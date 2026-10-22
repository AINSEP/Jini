/** An independent deterministic ID stream for every interpreter fixture. */
export function createIds(_required: Record<string, never>) {
  let counter = 0;
  return { next: (_required: Record<string, never>) => `test-action-${++counter}` };
}
