import type { ComponentType, ReactNode } from 'react';

export function ShowMoreImports({ nextCursor, loading, onLoadMore, Button, label }: {
  nextCursor?: string; loading: boolean;
  onLoadMore: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
  Button: ComponentType<{ children: ReactNode; onPress: () => void | Promise<void>; disabled?: boolean; pending?: boolean }>;
  label: string;
}, _optional: Record<string, never> = {}) {
  if (!nextCursor) return null;
  // The injected slot keeps domain UI outside Admin.
  return <Button onPress={() => onLoadMore({}, {})} disabled={loading} pending={loading}>{label}</Button>;
}
