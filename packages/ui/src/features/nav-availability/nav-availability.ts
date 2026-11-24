/**
 * Hover and accessible attributes for a navigation button that may be unavailable. Keep hover
 * explanations on aria-disabled buttons: native disabled suppresses their tooltips.
 * @param required.labels.unavailable the host's copy for an unavailable destination.
 * @complexity O(1).
 */
export function navAvailability(
  { label, disabled, labels }: { label: string; disabled?: boolean; labels: { readonly unavailable: string } }, _optional = {},
): { 'data-tip': string; title?: string; 'aria-description'?: string } {
  if (!disabled) return { 'data-tip': label };
  return { 'data-tip': `${label} — ${labels.unavailable}`, title: labels.unavailable, 'aria-description': labels.unavailable };
}
