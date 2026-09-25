import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const shadcnCheckboxPropsSchema = z
  .object({
    label: z.string().optional(),
    checked: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

export const shadcnCheckboxManifest: InteractiveComponentManifest = {
  id: 'shadcn.checkbox',
  provider: 'shadcn',
  capabilities: ['checkbox', 'toggle', 'form-field'],
  propsSchema: shadcnCheckboxPropsSchema,
  description: 'shadcn/ui Checkbox (real CLI-pulled source), paired with an optional label.',
};
