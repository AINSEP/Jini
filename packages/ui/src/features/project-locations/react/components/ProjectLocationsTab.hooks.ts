/** Choose the label that matches the current default-location selection. */
export function createDefaultControlLabel({ defaultBadge, makeDefaultLabel }: { defaultBadge: string; makeDefaultLabel: string }, _options = {}) {
  return (active: boolean): string => active ? defaultBadge : makeDefaultLabel;
}
