import { useCallback, useState } from 'react';

/** Shows reload failures using host-supplied copy; server-provided Error messages stay intact. */
export function useThemePreviewReloadButton(
  { label, failureLabel, reloadPreviews }: { label: string; failureLabel: string; reloadPreviews: () => Promise<void> },
  _optional: Record<string, never> = {},
) {
  const [error, setError] = useState<string | null>(null);
  const onReload = useCallback(() => {
    setError(null);
    void reloadPreviews().catch((error: unknown) =>
      setError(error instanceof Error ? error.message : failureLabel),
    );
  }, [reloadPreviews, failureLabel]);
  return { label, reload: onReload, error };
}
