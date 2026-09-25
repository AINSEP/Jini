/**
 * Ported verbatim from shadcn's `new-york` style registry (`ui.shadcn.com/r/styles/new-york/label.json`,
 * 2026-08-18). Only the `cn` import path changed, same as `table.tsx`. Pulled in because
 * `checkbox`/`radio-group`/`select` wrappers pair a visible label with their control.
 */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './lib/utils.js';

const labelVariants = cva('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70');

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
