import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const shadcnRadioGroupPropsSchema = z
  .object({
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()).min(1),
    value: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .passthrough();

export const shadcnRadioGroupManifest: InteractiveComponentManifest = {
  id: 'shadcn.radio-group',
  provider: 'shadcn',
  capabilities: ['radio', 'radio-group', 'form-field'],
  propsSchema: shadcnRadioGroupPropsSchema,
  description: 'shadcn/ui RadioGroup (real CLI-pulled source): a set of mutually exclusive options.',
};
