import { useCallback, useEffect, useRef, useState } from "react";

/**
 * @file The admin chat composer's folder button. A browser can never read a folder's OS path, so the
 * button asks the server to open the OS folder dialog instead — which only makes sense when the
 * server runs on this same machine (the host's folder-picker admin route decides that
 * and 404s/403s otherwise). The button shows only after that route confirms; any refusal keeps it
 * hidden. Inside the desktop app the same route works, since its server is local too.
 */

export interface UseNativeFolderPickerInput {
  /** Receives the chosen absolute path. Not called on Cancel. */
  readonly onPicked: (path: string) => void;
  /** Called once when the dialog could not be opened; the button hides itself at the same time. */
  readonly onFailed: () => void;
}

export interface UseNativeFolderPickerDeps {
  /** The host's folder-picker probe. Resolves only when the button may show. */
  readonly probe: () => Promise<unknown>;
  /** The host's folder-picker request; resolves `{ path: null }` on Cancel. */
  readonly pick: () => Promise<{ path: string | null }>;
  /** True for the host's "a dialog is already open" refusal (its HTTP 409), which is not a failure. */
  readonly isDialogAlreadyOpen: (error: unknown) => boolean;
}

export interface UseNativeFolderPicker {
  readonly available: boolean;
  /** True while the dialog is open; the button is disabled then. */
  readonly picking: boolean;
  readonly pickFolder: () => void;
}

/**
 * @complexity O(1) per call; one probe request per mount, one request per pick.
 */
export function useNativeFolderPicker(input: UseNativeFolderPickerInput, deps: UseNativeFolderPickerDeps): UseNativeFolderPicker {
  const { probe, pick, isDialogAlreadyOpen } = deps;
  const [available, setAvailable] = useState(false);
  const [picking, setPicking] = useState(false);
  // A ref, not `picking`, guards re-entry: two clicks in one tick both see the stale state value.
  const pickingRef = useRef(false);
  const mountedRef = useRef(true);
  const probeRef = useRef(probe);

  useEffect(() => {
    mountedRef.current = true;
    // Started inside a `then`, so even a synchronous throw lands in the rejection: hidden, never a crash.
    Promise.resolve().then(() => probeRef.current()).then(() => { if (mountedRef.current) setAvailable(true); }, () => {});
    return () => { mountedRef.current = false; };
  }, []);

  const { onPicked, onFailed } = input;
  const pickFolder = useCallback(() => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    void pick().then(({ path }) => {
      if (mountedRef.current && path) onPicked(path);
    }, (error: unknown) => {
      // 409: a dialog is already open (another tab). It is still usable; nothing failed here.
      if (!mountedRef.current || isDialogAlreadyOpen(error)) return;
      setAvailable(false);
      onFailed();
    }).finally(() => {
      pickingRef.current = false;
      if (mountedRef.current) setPicking(false);
    });
  }, [pick, isDialogAlreadyOpen, onPicked, onFailed]);

  return { available, picking, pickFolder };
}
