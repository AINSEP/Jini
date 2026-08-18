import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const shadcnTextInputPropsSchema = z
  .object({
    value: z.string().optional(),
    placeholder: z.string().optional(),
    disabled: z.boolean().optional(),
    type: z.enum(['text', 'email', 'password', 'number']).optional(),
  })
  .passthrough();

export const shadcnTextInputManifest: InteractiveComponentManifest = {
  id: 'shadcn.text-input',
  provider: 'shadcn',
  capabilities: ['input', 'text-input', 'form-field'],
  propsSchema: shadcnTextInputPropsSchema,
  description: 'shadcn/ui Input (real CLI-pulled source): a single-line text field.',
};
