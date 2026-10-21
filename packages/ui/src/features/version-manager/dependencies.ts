import { createBrowserViewerClipboard } from '../viewer-shell/index.js';
import type { VersionManagerFileRef, VersionRecord, VersionRestoreResult } from './types.js';
import type { VersionManagerClipboardPort, VersionManagerDependencies, VersionManagerPort } from './ports.js';

/**
 * An in-memory test/demo double, keyed by `fileRef.scopeId + ':' + fileRef.name`
 * so multiple file refs don't collide. Ships as the default (per the
 * `features/connectors/` canary's own precedent: "ship a fake, not a real
 * transport call") — a real host binds its own REST/daemon calls to
 * `VersionManagerPort` instead.
 */
export function createFakeVersionManagerPort<TVersion extends VersionRecord = VersionRecord>(
  seed?: ReadonlyMap<string, TVersion[]>,
  { content: seedContent }: { content?: ReadonlyMap<string, string> } = {},
): VersionManagerPort<TVersion> {
  const store = new Map<string, TVersion[]>(seed ? [...seed.entries()].map(([k, v]) => [k, [...v]]) : []);
  // Content uses the same scope/name key as metadata, followed by the version id.
  const content = new Map(seedContent);

  const key = (fileRef: VersionManagerFileRef) => `${fileRef.scopeId}:${fileRef.name}`;

  return {
    async listVersions(fileRef) {
      return store.get(key(fileRef)) ?? [];
    },
    async fetchVersionContent(fileRef, versionId) {
      return content.get(`${key(fileRef)}:${versionId}`) ?? null;
    },
    async restoreVersion(fileRef, version): Promise<VersionRestoreResult<TVersion> | null> {
      const list = store.get(key(fileRef)) ?? [];
      const restored = list.map((entry) => ({ ...entry, current: entry.id === version.id }));
      store.set(key(fileRef), restored);
      return { version };
    },
    resolvePreviewDocument(_fileRef, content) {
      return content;
    },
  };
}

/** Reuses `features/viewer-shell/`'s real browser clipboard implementation
 *  — clipboard access is a generic browser API with no backend shape to
 *  fake, same reasoning that feature's own `dependencies.ts` documents. */
export function createBrowserVersionManagerClipboard(): VersionManagerClipboardPort {
  return createBrowserViewerClipboard();
}

export function createDefaultVersionManagerDependencies<
  TVersion extends VersionRecord = VersionRecord,
>(): VersionManagerDependencies<TVersion> {
  return {
    versions: createFakeVersionManagerPort<TVersion>(),
    clipboard: createBrowserVersionManagerClipboard(),
  };
}

// Module-level singleton default — both the hook (`useWiredVersionManager`)
// and the orchestrator component (`VersionManagerModal`'s default
// `dependencies` prop) bind to this SAME instance, not independent calls to
// the factory above, so a caller that omits `dependencies` from both never
// ends up with two different fake ports fighting over one modal's state.
export const defaultVersionManagerDependencies: VersionManagerDependencies =
  createDefaultVersionManagerDependencies();
