/** Test composition binds the same platform owners used by a native embedding host. */
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, withFileLock,
  writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import type { ProjectFilesystemPort } from '../../core/project-filesystem.js';
import { openFileTreeProject as openProject, type OpenFileTreeProjectInput, type OpenFileTreeProjectOptions } from '../project.js';
import { createProjectPaths as createPaths } from '../paths.js';
import { createProjectStore as createStore, type StoreInput, type StoreOptions, type ProjectStore } from '../store.js';

const filesystem: ProjectFilesystemPort = {
  createReader: (input, options = {}) => createGuardedFileReader({ ...input, filesystem: createNodeGuardedReaderFilesystem({}) }, options),
  withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync,
};

/** Bind native effects without changing any project input, outcome or error contract. */
export function openFileTreeProject(input: Omit<OpenFileTreeProjectInput, 'filesystem'>, options: OpenFileTreeProjectOptions = {}): ReturnType<typeof openProject> {
  return openProject({ ...input, filesystem }, options);
}
/** Bind native containment for the existing path-policy checks. */
export function createProjectPaths(input: Omit<Parameters<typeof createPaths>[0], 'filesystem'>, options = {}): ReturnType<typeof createPaths> {
  return createPaths({ ...input, filesystem }, options);
}
/** Bind native locking/writes while preserving the deterministic crash seam. */
export function createProjectStore(input: Omit<StoreInput, 'filesystem'>, options: StoreOptions = {}): ProjectStore {
  return createStore({ ...input, filesystem }, options);
}
export type { StoreCheckpoint } from '../store.js';
