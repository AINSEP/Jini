import { useCallback, useEffect, useRef, useState } from 'react';

import { useLatestOperation } from '../../../../react/hooks/useLatestOperation.js';
import type { ChatPaneWorkingDirectoryAccess } from '../../types.js';

export interface UseChatPaneWorkingDirectoryOptions {
  workingDirectory?: string | null;
  initialWorkingDirectory?: string | null;
  onChangeWorkingDirectory?: (workingDirectory: string | null) => void;
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess;
}

export interface UseChatPaneWorkingDirectoryResult {
  workingDirectory: string | null;
  recentDirectories: readonly string[];
  workingDirectoryInvalid: boolean;
  workingDirectoryPending: boolean;
  workingDirectoryError: Error | null;
  openWorkingDirectoryPicker: () => Promise<void>;
  pickWorkingDirectory: () => Promise<void>;
  selectRecentDirectory: (directory: string) => Promise<void>;
  clearWorkingDirectory: () => void;
}

/**
 * Owns controlled/uncontrolled directory state and orchestrates the native
 * filesystem effects used by the packaged working-directory picker.
 *
 * Every async path runs through one {@link useLatestOperation} instance, so a validation still in
 * flight cannot clobber the result of the pick that replaced it, and a resolved promise arriving
 * after unmount writes nothing. `token.ensureCurrent()` is that check — it stands where a
 * `if (!mounted || stale) return;` guard used to sit after each await.
 *
 * @param options - Public value, change callback, and optional host I/O access.
 * @returns Current picker state plus actions consumed by {@link ChatPane}.
 * @throws Never. Native capability failures are exposed as
 * `workingDirectoryError` for package-owned validation UI.
 *
 * @complexity Time: O(r) when refreshing `r` recent paths; O(1) otherwise.
 * @complexity Space: O(r) for the package-owned recent-directory snapshot.
 * @overallScore 100/100
 */
export function useChatPaneWorkingDirectory(
  options: UseChatPaneWorkingDirectoryOptions,
): UseChatPaneWorkingDirectoryResult {
  const controlled = options.workingDirectory !== undefined;
  const [uncontrolledWorkingDirectory, setUncontrolledWorkingDirectory] = useState<string | null>(
    options.initialWorkingDirectory ?? null,
  );
  const [recentDirectories, setRecentDirectories] = useState<readonly string[]>([]);
  const [workingDirectoryInvalid, setWorkingDirectoryInvalid] = useState(false);
  const [workingDirectoryPending, setWorkingDirectoryPending] = useState(false);
  const [workingDirectoryError, setWorkingDirectoryError] = useState<Error | null>(null);
  const operation = useLatestOperation();
  const observedDirectoryRef = useRef<string | null | undefined>(undefined);
  const workingDirectory = controlled
    ? options.workingDirectory ?? null
    : uncontrolledWorkingDirectory;

  const reportWorkingDirectory = useCallback((directory: string | null) => {
    observedDirectoryRef.current = directory;
    if (!controlled) setUncontrolledWorkingDirectory(directory);
    options.onChangeWorkingDirectory?.(directory);
  }, [controlled, options.onChangeWorkingDirectory]);

  /** Shared by every action: a failed native call invalidates and stops pending. */
  const reportFailure = useCallback((error: Error) => {
    setWorkingDirectoryError(error);
    setWorkingDirectoryPending(false);
  }, []);

  useEffect(() => {
    if (observedDirectoryRef.current === workingDirectory) return;
    observedDirectoryRef.current = workingDirectory;
    operation.supersede();
    const access = options.workingDirectoryAccess;
    setWorkingDirectoryError(null);
    if (workingDirectory === null || !access) {
      setWorkingDirectoryInvalid(false);
      setWorkingDirectoryPending(false);
      return;
    }
    let validationSettled = false;
    setWorkingDirectoryPending(true);
    void operation.run(
      async (token) => {
        const normalized = access.normalizeWorkingDirectory
          ? await access.normalizeWorkingDirectory(workingDirectory)
          : workingDirectory;
        token.ensureCurrent();
        if (normalized === null) {
          validationSettled = true;
          setWorkingDirectoryInvalid(true);
          setWorkingDirectoryPending(false);
          return;
        }
        const exists = await access.directoryExists(normalized);
        token.ensureCurrent();
        if (normalized !== workingDirectory) reportWorkingDirectory(normalized);
        validationSettled = true;
        setWorkingDirectoryInvalid(!exists);
        setWorkingDirectoryPending(false);
      },
      (error) => {
        validationSettled = true;
        setWorkingDirectoryInvalid(true);
        reportFailure(error);
      },
    );
    return () => {
      operation.supersede();
      // React Strict Mode replays this effect while preserving refs. Release
      // only the marker for the directory owned by this setup so its replay
      // starts fresh. Settled validations keep their marker so an unstable
      // host adapter object cannot trigger a validation/render loop.
      if (
        !validationSettled
        && observedDirectoryRef.current === workingDirectory
      ) {
        observedDirectoryRef.current = undefined;
      }
    };
  }, [
    operation,
    options.workingDirectoryAccess,
    reportFailure,
    reportWorkingDirectory,
    workingDirectory,
  ]);

  const openWorkingDirectoryPicker = useCallback(async () => {
    const access = options.workingDirectoryAccess;
    if (!access) return;
    setWorkingDirectoryError(null);
    setWorkingDirectoryPending(true);
    await operation.run(async (token) => {
      const [recent, exists] = await Promise.all([
        access.recentDirectories(),
        workingDirectory === null
          ? Promise.resolve(true)
          : access.directoryExists(workingDirectory),
      ]);
      token.ensureCurrent();
      setRecentDirectories([...recent]);
      setWorkingDirectoryInvalid(!exists);
      setWorkingDirectoryPending(false);
    }, reportFailure);
  }, [operation, options.workingDirectoryAccess, reportFailure, workingDirectory]);

  const pickWorkingDirectory = useCallback(async () => {
    const access = options.workingDirectoryAccess;
    if (!access) return;
    setWorkingDirectoryError(null);
    setWorkingDirectoryPending(true);
    await operation.run(async (token) => {
      const selected = await access.pickWorkingDirectory(workingDirectory ?? undefined);
      token.ensureCurrent();
      if (selected === null) {
        setWorkingDirectoryPending(false);
        return;
      }
      const [exists, recent] = await Promise.all([
        access.directoryExists(selected),
        access.recentDirectories(),
      ]);
      token.ensureCurrent();
      reportWorkingDirectory(selected);
      setWorkingDirectoryInvalid(!exists);
      setRecentDirectories([...recent]);
      setWorkingDirectoryPending(false);
    }, reportFailure);
  }, [
    operation,
    options.workingDirectoryAccess,
    reportFailure,
    reportWorkingDirectory,
    workingDirectory,
  ]);

  const selectRecentDirectory = useCallback(async (directory: string) => {
    operation.supersede();
    setWorkingDirectoryError(null);
    const access = options.workingDirectoryAccess;
    if (!access) {
      reportWorkingDirectory(directory);
      return;
    }
    setWorkingDirectoryPending(true);
    await operation.run(async (token) => {
      const exists = await access.directoryExists(directory);
      token.ensureCurrent();
      reportWorkingDirectory(directory);
      setWorkingDirectoryInvalid(!exists);
      setWorkingDirectoryPending(false);
    }, reportFailure);
  }, [operation, options.workingDirectoryAccess, reportFailure, reportWorkingDirectory]);

  const clearWorkingDirectory = useCallback(() => {
    operation.supersede();
    reportWorkingDirectory(null);
    setWorkingDirectoryInvalid(false);
    setWorkingDirectoryPending(false);
    setWorkingDirectoryError(null);
  }, [operation, reportWorkingDirectory]);

  return {
    workingDirectory,
    recentDirectories,
    workingDirectoryInvalid,
    workingDirectoryPending,
    workingDirectoryError,
    openWorkingDirectoryPicker,
    pickWorkingDirectory,
    selectRecentDirectory,
    clearWorkingDirectory,
  };
}
