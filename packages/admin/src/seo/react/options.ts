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
  headerActions?: ReactNode;
  slots?: { MediaPickerDialog?: ComponentType<SeoMediaPickerSlotProps> };
}
