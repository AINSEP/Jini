import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const shadcnCardPropsSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

export const shadcnCardManifest: InteractiveComponentManifest = {
  id: 'shadcn.card',
  provider: 'shadcn',
  capabilities: ['card', 'container'],
  propsSchema: shadcnCardPropsSchema,
  description:
    'shadcn/ui Card (real CLI-pulled source): a title/description/body text container. A leaf, not a generic children slot — the a2ui renderer resolves registry components without recursing into their props, same as data-table.',
};
