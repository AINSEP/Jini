/** Append work to a fulfilled serial tail and report failures without rejecting the next tail.
 * The observer owns failure policy and must not throw. Callers retain the returned tail to drain.
 * @complexity O(1) scheduling time and space per task, excluding task work.
 */
export function appendSerialTask({ previous, task, onError }: {
  previous: Promise<void>;
  task: () => Promise<unknown>;
  onError: (error: unknown) => void;
}, _optional: Record<string, never> = {}): Promise<void> {
  return previous.then(task).then(() => undefined, onError);
}
