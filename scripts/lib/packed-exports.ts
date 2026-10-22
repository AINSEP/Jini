/** Check all export targets against the packed file inventory, including nested conditions.
 * Throws for missing files or non-relative targets. Null exclusions need no file.
 * @complexity O(F + E × F) worst case for E wildcard targets over F packed files; no I/O.
 */
export function assertPackedExports(
  { manifest, packedPaths }: {
    manifest: { readonly name?: string; readonly exports?: unknown };
    packedPaths: readonly string[];
  },
  _options: Record<string, never> = {},
): void {
  const files = new Set(packedPaths.filter(path => path && !path.endsWith('/'))
    .map(path => path.replace(/^\.\//, '').replace(/^package\//, '')));
  const targets = new Set<string>();
  function collect(value: unknown): void {
    if (typeof value === 'string') targets.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(manifest.exports);
  const missing: string[] = [];
  for (const target of targets) {
    if (!target.startsWith('./')) throw new Error(`${manifest.name}: invalid export target: ${target}`);
    const path = target.slice(2);
    // Subpath patterns denote a family of files; an empty family is a broken export too.
    let present = files.has(path);
    if (path.includes('*')) {
      const pattern = new RegExp(`^${path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      present = [...files].some(file => pattern.test(file));
    }
    if (!present) missing.push(target);
  }
  if (missing.length) throw new Error(`${manifest.name}: exported paths missing from tarball: ${missing.join(', ')}`);
}
