// Trailing-debounce a fast-changing value (e.g. a search box) before it
// drives an expensive downstream effect (a network fetch). Not tied to any
// one feature domain — feature-local hooks live inside their own
// `features/<domain>/react/hooks/` instead.
import { useEffect, useState } from 'react';

export interface DebounceSchedulerPort {
  schedule(requiredArgs: { callback: () => void; delayMs: number }): () => void;
}

const browserScheduler: DebounceSchedulerPort = {
  schedule: ({ callback, delayMs }) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export function useDebouncedValue<T>(
  { value, delayMs }: { value: T; delayMs: number },
  { scheduler = browserScheduler }: { scheduler?: DebounceSchedulerPort } = {},
): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    return scheduler.schedule({ callback: () => setDebounced(value), delayMs });
  }, [value, delayMs, scheduler]);

  return debounced;
}
