import type { CSSProperties } from 'react';

/**
 * Inline style for the memory editor's field labels.
 *
 * Lives on the React side rather than in this feature's `constants.ts`:
 * a `CSSProperties` object is presentation, and it is the one thing in that
 * module that could not cross into a framework-free package. Everything else
 * there is plain data.
 */
export const FIELD_LABEL_STYLE: CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'var(--text-muted, #888)',
  marginBottom: 4,
};
