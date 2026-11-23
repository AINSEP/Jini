import { useCallback, useState } from "react";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { parseMediaGridSize, type MediaGridSize } from "../grid-size.js";

/** Required args: the host owns the browser-storage key its saved choice lives under. */
export interface UseMediaGridSizeArgs {
  storageKey: string;
}

/** The Media grid's card size, remembered per browser (owner, 2026-11-01). Storage can be
 *  unavailable (private mode, blocked): the choice then just lasts for the visit. */
export function useMediaGridSize({ storageKey }: UseMediaGridSizeArgs, _optional: Record<string, never> = {}): [MediaGridSize, (size: MediaGridSize) => void] {
  const [size, setSizeState] = useState<MediaGridSize>(() => orFallbackSync({ work: () => parseMediaGridSize({ value: window.localStorage.getItem(storageKey) }), fallback: "medium", step: "Read media grid size" }));
  const setSize = useCallback((next: MediaGridSize) => {
    setSizeState(next);
    orFallbackSync({ work: () => window.localStorage.setItem(storageKey, next), fallback: undefined, step: "Save media grid size" }); /* not remembered */
  }, [storageKey]);
  return [size, setSize];
}
