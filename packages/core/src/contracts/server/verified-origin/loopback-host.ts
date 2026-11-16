/** Public identity must not name a development listener. Normalize URL spellings first so
 * shortened IPv4 and IPv4-mapped IPv6 cannot bypass the same rule used for localhost.
 * Private intranet hosts remain valid. Invalid hosts are left to the caller's URL validation.
 * @complexity O(host bytes), pure; parse failures return false.
 */
export function isLoopbackHost({ host }: { host: string }, _options = {}): boolean {
  let hostname: string;
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  try { hostname = new URL(`http://${authority}`).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return false; }
  return /^(?:localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[(?:::1|::|::ffff:7f[\da-f]{2}:[\da-f]+)\])$/.test(hostname);
}
