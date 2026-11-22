/** `camelCase` theme key → `kebab-case` CSS custom-property segment (`surfaceMuted` → `surface-muted`). */
export function kebabThemeKey({ key }: { key: string }, _optional: Record<string, never> = {}): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
