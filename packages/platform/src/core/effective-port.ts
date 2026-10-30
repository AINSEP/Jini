/** The port a URL actually connects to: its explicit port, else 443 for `https:` and 80 otherwise.
 *  @complexity O(1). */
export function effectivePort({ url }: { url: URL }, _optional: Record<string, never> = {}): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}
