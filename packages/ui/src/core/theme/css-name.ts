/** `camelCase` theme key → `kebab-case` CSS custom-property segment (`surfaceMuted` → `surface-muted`). */
export function kebabThemeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
