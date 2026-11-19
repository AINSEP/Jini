import { AsyncLocalStorage } from 'node:async_hooks';

export type ThemeFileAddress = { themeDir: string; themesRoot: string; relativePath: string };

/** What a tool reviewed before it asked the persistence owner to write: the file and the SHA-256 it had then. */
export type ReviewedThemeFile = {
  file: ThemeFileAddress;
  target: string;
  version: string | null;
};

/** The reviewed file, and the version the write inside this scope committed (set once its rename succeeded). */
export type ReviewedWriteScope = { prepared: ReviewedThemeFile; committed: string | undefined };

const reviewedThemeWrite = new AsyncLocalStorage<ReviewedWriteScope>();

/** The scope the current write runs in, when a tool opened one. */
export const reviewedWriteScope = (_required: Record<string, never> = {}, _optional: Record<string, never> = {}): ReviewedWriteScope | undefined => reviewedThemeWrite.getStore();

/** Carry a tool's reviewed destination through asynchronous source reads to every theme writer.
 * Async-local scope keeps concurrent imports isolated without putting trusted state in tool input.
 * @returns The original handler's result and the version the write itself committed (`undefined` when it wrote
 * nothing). A stale destination fails before persistence. The committed version is what a batch pins its next item
 * to: it comes from the write, never from reading the file again, which would adopt a foreign writer's bytes.
 * @complexity O(1) scope setup; the commit compares O(destination bytes).
 */
export async function runReviewedThemeFileWrite<T>(
  { prepared, run }: { prepared: ReviewedThemeFile; run: () => Promise<T> },
  _options: Record<string, never> = {},
): Promise<{ result: T; committedVersion: string | undefined }> {
  const scope: ReviewedWriteScope = { prepared, committed: undefined };
  const result = await reviewedThemeWrite.run(scope, run);
  return { result, committedVersion: scope.committed };
}

