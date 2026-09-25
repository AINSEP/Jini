import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

/**
 * `.passthrough()` for the same reason as `data-table.manifest.ts` — an A2UI-embedded instance
 * may carry an `action` prop this schema doesn't itself validate.
 */
export const shadcnButtonPropsSchema = z
  .object({
    label: z.string(),
    variant: z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']).optional(),
    size: z.enum(['default', 'sm', 'lg', 'icon']).optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

export const shadcnButtonManifest: InteractiveComponentManifest = {
  id: 'shadcn.button',
  provider: 'shadcn',
  capabilities: ['button', 'action'],
  propsSchema: shadcnButtonPropsSchema,
  description: 'shadcn/ui Button (real CLI-pulled source): a labeled, styled action trigger.',
};
