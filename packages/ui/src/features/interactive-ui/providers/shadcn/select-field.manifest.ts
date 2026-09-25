import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const shadcnSelectPropsSchema = z
  .object({
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()).min(1),
    value: z.string().optional(),
    placeholder: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

export const shadcnSelectManifest: InteractiveComponentManifest = {
  id: 'shadcn.select',
  provider: 'shadcn',
  capabilities: ['select', 'dropdown', 'form-field'],
  propsSchema: shadcnSelectPropsSchema,
  description: 'shadcn/ui Select (real CLI-pulled source): a dropdown chosen from a fixed option list.',
};
