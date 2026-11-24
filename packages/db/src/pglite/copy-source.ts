/**
 * @file The served-versus-stopped copy lifecycle of a PGlite data dir.
 *
 * Reaching the source: when THIS process serves it (copying the store you are running), through its owner's
 * exclusive window; otherwise the source must be stopped — the copy takes the data dir's owner lock for the
 * duration, so nothing writes to it meanwhile. A source served by another live process is refused by the
 * lock port (its owner is the only one who may open it); the host maps that refusal to its own error.
 */

/** What the host supplies: the concrete PGlite owner/kernel/storage operations and the lock-refusal mapping. */
export interface PgliteSourceCopyPorts<Owner, Source extends { close(): Promise<void> }> {
  runningOwner(required: { dataDir: string }): Owner | undefined;
  copyServed(required: { owner: Owner; targetPath: string }): Promise<void>;
  /** Takes the data dir's owner lock and returns its release; throws the host's error when another process holds it. */
  acquireOwnerLock(required: { dataDir: string }): () => void;
  /** May throw synchronously. */
  openStopped(required: { dataDir: string }): Source;
  copyStopped(required: { source: Source; targetPath: string }): Promise<void>;
}

/**
 * Copies the source data dir to `targetDataDir` through the right door (see this file's header).
 * @throws Whatever a port throws (the lock refusal, an open or copy failure); the owner lock is always released.
 * @complexity One dump + restore of the whole data dir, bounded by the site's size.
 */
export async function copyPgliteSourceTo<Owner, Source extends { close(): Promise<void> }>(
  { sourceDataDir, targetDataDir, ports }: { sourceDataDir: string; targetDataDir: string; ports: PgliteSourceCopyPorts<Owner, Source> },
  _optional = {},
): Promise<void> {
  const owner = ports.runningOwner({ dataDir: sourceDataDir });
  if (owner !== undefined) {
    await ports.copyServed({ owner, targetPath: targetDataDir });
    return;
  }
  const release = ports.acquireOwnerLock({ dataDir: sourceDataDir });
  // Nested so the lock is released however the open, the copy or the close fails: the open can
  // throw synchronously, and a rejected close must not skip `release()` for the process's life.
  try {
    const source = ports.openStopped({ dataDir: sourceDataDir });
    try {
      await ports.copyStopped({ source, targetPath: targetDataDir });
    } finally {
      await source.close();
    }
  } finally {
    release();
  }
}
