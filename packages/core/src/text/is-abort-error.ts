/** Duck-type the name: DOMException's instanceof Error result depends on its browser realm. */
export function isAbortError({ error }: { error: unknown }, _options = {}): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}
