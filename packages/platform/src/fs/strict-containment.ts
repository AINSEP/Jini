/** Preserve strict lexical containment: relative roots, root equality and traversal are refused (except the filesystem-root edge case). Symlinks require a separate physical-path guard. */
import path from "node:path";

export function resolvePathWithin({ root, segment }: { root: string; segment: string }): string | null {
  const resolved = path.resolve(root, segment);
  if (resolved !== path.join(root, segment)) return null;
  const normalizedRoot = path.resolve(root);
  const prefix = normalizedRoot === path.sep ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  if (!resolved.startsWith(prefix)) return null;
  return resolved;
}
