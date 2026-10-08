import type { ComponentType, ReactNode } from 'react';
import type { SeoMediaSelection, SeoTranslator, SeoErrorFormatter } from '../models.js';
/** Host dialog wrapper keeps its existing media service, DOM and caller-specific handle ids. */
export interface SeoMediaPickerSlotProps {
  onSelect: (item: SeoMediaSelection) => void;
  onCancel: () => void;
  accept?: readonly string[];
  agentHandle?: string | undefined;
}
export interface SeoReactOptions {
  siteUrl: () => string;
  t?: SeoTranslator | undefined;
  describeError?: SeoErrorFormatter | undefined;
  /** Format parsed lastmod values in the host's live locale/timezone; raw XML remains untouched.
   * Omit to use the shared compact ISO timestamp display.
   * @example ({ iso }) => formDateDisplay({ iso, locale }).text
   */
  formatDate?: ((required: { iso: string }, optional?: Record<string, never>) => string) | undefined;
  headerActions?: ReactNode;
  slots?: { MediaPickerDialog?: ComponentType<SeoMediaPickerSlotProps> };
}
