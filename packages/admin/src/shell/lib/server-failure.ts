/** True for the failures the request layer raises the shared failure notice for: no response, or a 5xx.
 * An editor shows a short plain line for these instead of repeating the raw server message the notice already carries.
 * @complexity O(1). */
export function isUnexpectedServerFailure({ error }: { error: unknown }, _options = {}): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && (status === 0 || status >= 500);
}
