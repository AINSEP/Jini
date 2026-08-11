/**
 * Ported verbatim from `npx shadcn@latest add table` (real CLI run, 2026-08-08, against a
 * scratch Vite+Tailwind v4 project — see source-map.md). Only the import path changed:
 * shadcn's default `@/lib/utils` alias doesn't exist in this monorepo, so `table.tsx` imports
 * this by relative path instead.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
