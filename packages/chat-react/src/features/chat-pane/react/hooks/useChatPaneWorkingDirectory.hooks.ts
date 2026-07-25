import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatPaneWorkingDirectoryAccess } from '../../types.js';

/**
 * Preserves native Error objects while normalizing opaque bridge rejections.
 *
 * @complexity Time/space: O(1).
 * @overallScore 100/100
 */
function normalizeWorkingDirectoryError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

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
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const observedDirectoryRef = useRef<string | null | undefined>(undefined);
  const workingDirectory = controlled
    ? options.workingDirectory ?? null
    : uncontrolledWorkingDirectory;

  const reportWorkingDirectory = useCallback((directory: string | null) => {
    observedDirectoryRef.current = directory;
    if (!controlled) setUncontrolledWorkingDirectory(directory);
    options.onChangeWorkingDirectory?.(directory);
  }, [controlled, options.onChangeWorkingDirectory]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (observedDirectoryRef.current === workingDirectory) return;
    observedDirectoryRef.current = workingDirectory;
    const generation = ++operationGenerationRef.current;
    const access = options.workingDirectoryAccess;
    setWorkingDirectoryError(null);
    if (workingDirectory === null || !access) {
      setWorkingDirectoryInvalid(false);
      setWorkingDirectoryPending(false);
      return;
    }
    let validationSettled = false;
    setWorkingDirectoryPending(true);
    void (async () => {
      try {
        const normalized = access.normalizeWorkingDirectory
          ? await access.normalizeWorkingDirectory(workingDirectory)
          : workingDirectory;
        if (
          !mountedRef.current
          || generation !== operationGenerationRef.current
        ) return;
        if (normalized === null) {
          validationSettled = true;
          setWorkingDirectoryInvalid(true);
          setWorkingDirectoryPending(false);
          return;
        }
        const exists = await access.directoryExists(normalized);
        if (
          !mountedRef.current
          || generation !== operationGenerationRef.current
        ) return;
        if (normalized !== workingDirectory) {
          reportWorkingDirectory(normalized);
        }
        validationSettled = true;
        setWorkingDirectoryInvalid(!exists);
        setWorkingDirectoryPending(false);
      } catch (error) {
        if (
          !mountedRef.current
          || generation !== operationGenerationRef.current
        ) return;
        validationSettled = true;
        setWorkingDirectoryError(normalizeWorkingDirectoryError(error));
        setWorkingDirectoryInvalid(true);
        setWorkingDirectoryPending(false);
      }
    })();
    return () => {
      operationGenerationRef.current += 1;
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
    options.workingDirectoryAccess,
    reportWorkingDirectory,
    workingDirectory,
  ]);

  const openWorkingDirectoryPicker = useCallback(async () => {
    const access = options.workingDirectoryAccess;
    if (!access) return;
    const generation = ++operationGenerationRef.current;
    setWorkingDirectoryError(null);
    setWorkingDirectoryPending(true);
    try {
      const [recent, exists] = await Promise.all([
        access.recentDirectories(),
        workingDirectory === null
          ? Promise.resolve(true)
          : access.directoryExists(workingDirectory),
      ]);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setRecentDirectories([...recent]);
      setWorkingDirectoryInvalid(!exists);
      setWorkingDirectoryPending(false);
    } catch (error) {
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setWorkingDirectoryError(normalizeWorkingDirectoryError(error));
      setWorkingDirectoryPending(false);
    }
  }, [options.workingDirectoryAccess, workingDirectory]);

  const pickWorkingDirectory = useCallback(async () => {
    const access = options.workingDirectoryAccess;
    if (!access) return;
    const generation = ++operationGenerationRef.current;
    setWorkingDirectoryError(null);
    setWorkingDirectoryPending(true);
    try {
      const selected = await access.pickWorkingDirectory(workingDirectory ?? undefined);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      if (selected === null) {
        setWorkingDirectoryPending(false);
        return;
      }
      const [exists, recent] = await Promise.all([
        access.directoryExists(selected),
        access.recentDirectories(),
      ]);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      reportWorkingDirectory(selected);
      setWorkingDirectoryInvalid(!exists);
      setRecentDirectories([...recent]);
      setWorkingDirectoryPending(false);
    } catch (error) {
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setWorkingDirectoryError(normalizeWorkingDirectoryError(error));
      setWorkingDirectoryPending(false);
    }
  }, [options.workingDirectoryAccess, reportWorkingDirectory, workingDirectory]);

  const selectRecentDirectory = useCallback(async (directory: string) => {
    const generation = ++operationGenerationRef.current;
    setWorkingDirectoryError(null);
    const access = options.workingDirectoryAccess;
    if (!access) {
      reportWorkingDirectory(directory);
      return;
    }
    setWorkingDirectoryPending(true);
    try {
      const exists = await access.directoryExists(directory);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      reportWorkingDirectory(directory);
      setWorkingDirectoryInvalid(!exists);
      setWorkingDirectoryPending(false);
    } catch (error) {
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setWorkingDirectoryError(normalizeWorkingDirectoryError(error));
      setWorkingDirectoryPending(false);
    }
  }, [options.workingDirectoryAccess, reportWorkingDirectory]);

  const clearWorkingDirectory = useCallback(() => {
    operationGenerationRef.current += 1;
    reportWorkingDirectory(null);
    setWorkingDirectoryInvalid(false);
    setWorkingDirectoryPending(false);
    setWorkingDirectoryError(null);
  }, [reportWorkingDirectory]);

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
