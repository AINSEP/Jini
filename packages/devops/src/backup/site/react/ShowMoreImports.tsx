import type { ComponentType, ReactNode } from 'react';

/**
 * The host's button slot. `onPress` uses the two-object action shape every admin kit button
 * already takes, so a host passes its kit `Button` unchanged; a zero-argument handler type would
 * reject a kit whose `defaultProps.onPress` declares those arguments. The props are optional and
 * readonly for the same reason: kit buttons declare them that way.
 */
export type ShowMoreImportsButton = ComponentType<{
  readonly children?: ReactNode;
  readonly onPress?: (required: Record<string, never>, optional?: Record<string, never>) => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
}>;

export function ShowMoreImports({ nextCursor, loading, onLoadMore, Button, label }: {
  nextCursor?: string; loading: boolean;
  onLoadMore: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
  Button: ShowMoreImportsButton;
  label: string;
}, _optional: Record<string, never> = {}) {
  if (!nextCursor) return null;
  // The injected slot keeps domain UI outside Admin.
  return <Button onPress={() => { void onLoadMore({}, {}); }} disabled={loading} pending={loading}>{label}</Button>;
}
